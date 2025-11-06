/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {BundleEntry} from "fhir/r4"

import {badRequest, conflictDuplicate} from "../src/utils/responses"
import {
  DEFAULT_DATE,
  X_REQUEST_ID,
  mockInternalDependency,
  validTask,
  getTestPrescriptions
} from "./utils/testUtils"
import {APIGatewayProxyEvent} from "aws-lambda"

import * as content from "../src/validation/content"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
const mockValidateEntry = mockInternalDependency("../../src/validation/content", content, "validateEntry")

const mockGetParametersByName = jest.fn(async () => Promise.resolve(
  {[process.env.ENABLE_NOTIFICATIONS_PARAM!]: "false"}
))

const mockInitiatedSSMProvider = {
  getParametersByName: mockGetParametersByName
}

jest.unstable_mockModule("@psu-common/utilities", async () => ({
  getTestPrescriptions: getTestPrescriptions,
  initiatedSSMProvider: mockInitiatedSSMProvider
}))

const {castEventBody, getXRequestID, validateEntries, handleTransactionCancelledException, buildDataItems, TTL_DELTA} =
  await import("../src/updatePrescriptionStatus")

describe("Unit test getXRequestID", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when event has x-request-id, return it and no response entry", async () => {
    const event: unknown = {headers: {"x-request-id": X_REQUEST_ID}}
    const responseEntries: Array<BundleEntry> = []

    const result = getXRequestID(event as APIGatewayProxyEvent, responseEntries)

    expect(result).toEqual(X_REQUEST_ID)
    expect(responseEntries.length).toEqual(0)
  })

  it.each([
    {
      event: {headers: {"x-request-id": ""}} as unknown,
      scenarioDescription: "when event has empty x-request-id, return undefined and a response entry"
    },
    {
      event: {headers: {}} as unknown,
      scenarioDescription: "when event has a missing x-request-id, return undefined and a response entry"
    }
  ])("$scenarioDescription", async ({event}) => {
    const responseEntries: Array<BundleEntry> = []

    const result = getXRequestID(event as APIGatewayProxyEvent, responseEntries)

    expect(result).toEqual(undefined)
    expect(responseEntries.length).toEqual(1)
    expect(responseEntries[0]).toEqual(badRequest("Missing or empty x-request-id header."))
  })
})

describe("Unit test castEventBody", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when body doesn't have correct resourceType and type, return undefined and a response entry", async () => {
    const body = {resourceType: "NotBundle", type: "not_transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toEqual(undefined)
    expect(responseEntries.length).toEqual(1)
    expect(responseEntries[0]).toEqual(
      badRequest("Request body does not have resourceType of 'Bundle' and type of 'transaction'.")
    )
  })

  it("when body has correct resourceType and type, return bundle and no response entries", async () => {
    const body = {resourceType: "Bundle", type: "transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toBeDefined()
    expect(responseEntries.length).toEqual(0)
  })
})

describe("Unit test validateEntries", () => {
  it("when a single entry is valid, returns true with a response in the response bundle", async () => {
    mockValidateEntry.mockReturnValue({valid: true, issues: undefined})

    const requestEntries = [{resource: {}, fullUrl: "valid"}] as Array<BundleEntry>
    const responseEntries: Array<BundleEntry> = []

    const result = validateEntries(requestEntries, responseEntries)

    expect(result).toEqual(true)
    expect(responseEntries.length).toEqual(1)

    const validResponseEntry = responseEntries[0]
    expect(validResponseEntry.fullUrl).toEqual("valid")
    expect(validResponseEntry.response?.status).toEqual("200 OK")
  })

  it("when one of two entries is invalid, returns false with two responses in the response bundle", async () => {
    mockValidateEntry.mockImplementation((entry: any) => {
      if (entry.fullUrl === "valid") {
        return {valid: true, issues: undefined}
      }
      return {valid: false, issues: "issues"}
    })

    const requestEntries = [
      {resource: {}, fullUrl: "valid"},
      {resource: {}, fullUrl: "invalid"}
    ] as Array<BundleEntry>
    const responseEntries: Array<BundleEntry> = []

    const result = validateEntries(requestEntries, responseEntries)

    expect(result).toEqual(false)
    expect(responseEntries.length).toEqual(2)

    const validResponseEntry = responseEntries[0]
    expect(validResponseEntry.fullUrl).toEqual("valid")
    expect(validResponseEntry.response?.status).toEqual("200 OK")

    const inValidResponseEntry = responseEntries[1]
    expect(inValidResponseEntry.fullUrl).toEqual("invalid")
    expect(inValidResponseEntry.response?.status).toEqual("400 Bad Request")
  })
})

describe("handleTransactionCancelledException", () => {
  it("should add a conflictDuplicate entry to responseEntries", () => {
    const responseEntries: Array<any> = []
    const mockException: TransactionCanceledException = {
      name: "TransactionCanceledException",
      message: "DynamoDB transaction cancelled due to conditional check failure.",
      $fault: "client",
      $metadata: {},
      CancellationReasons: [
        {
          Code: "ConditionalCheckFailed",
          Item: {
            TaskID: {S: "d70678c-81e4-6665-8c67-17596fd0aa87"}
          },
          Message: "The conditional request failed"
        }
      ]
    }

    handleTransactionCancelledException(mockException, responseEntries)
    const validResponseEntry = responseEntries[0]

    expect(responseEntries).toHaveLength(1)
    expect(validResponseEntry).toEqual(conflictDuplicate("d70678c-81e4-6665-8c67-17596fd0aa87"))
    expect(validResponseEntry.response?.status).toEqual("409 Conflict")
  })

  it("should replaces a 200 for a duplicate item with a conflictDuplicate entry to responseEntries", () => {
    const responseEntries: Array<any> = [
      {
        fullUrl: "urn:uuid:d70678c-81e4-6665-8c67-17596fd0aa87",
        response: {
          outcome: {
            issue: [
              {
                code: "informational",
                diagnostics: "Data not committed due to issues in other entries.",
                severity: "information"
              }
            ],
            meta: {lastUpdated: "2023-09-11T10:11:12.000Z"},
            resourceType: "OperationOutcome"
          },
          status: "200 OK"
        }
      }
    ]
    const mockException: TransactionCanceledException = {
      name: "TransactionCanceledException",
      message: "DynamoDB transaction cancelled due to conditional check failure.",
      $fault: "client",
      $metadata: {},
      CancellationReasons: [
        {
          Code: "ConditionalCheckFailed",
          Item: {
            TaskID: {S: "d70678c-81e4-6665-8c67-17596fd0aa87"}
          },
          Message: "The conditional request failed"
        }
      ]
    }

    handleTransactionCancelledException(mockException, responseEntries)
    const validResponseEntry = responseEntries[0]

    expect(responseEntries).toHaveLength(1)
    expect(validResponseEntry).toEqual(conflictDuplicate("d70678c-81e4-6665-8c67-17596fd0aa87"))
    expect(validResponseEntry.response?.status).toEqual("409 Conflict")
    expect(validResponseEntry.response?.status).not.toEqual("200 OK")
  })
})

describe("buildDataItems", () => {
  it("should uppercase LineItemId, PharmacyODSCode and PrescriptionID", () => {
    const task = validTask()
    const lineItemID = crypto.randomUUID().toUpperCase()
    const pharmacyODSCode = "X26"
    const prescriptionID = "4F00A8-A83008-2EB4D"

    task.focus!.identifier!.value! = lineItemID.toLowerCase()
    task.owner!.identifier!.value! = pharmacyODSCode.toLowerCase()
    task.basedOn![0].identifier!.value! = prescriptionID.toLowerCase()
    const requestEntry: BundleEntry = {
      resource: task,
      fullUrl: ""
    }

    const dataItems = buildDataItems([requestEntry], "", "")

    expect(dataItems[0].LineItemID).toEqual(lineItemID)
    expect(dataItems[0].PrescriptionID).toEqual(prescriptionID)
    expect(dataItems[0].PharmacyODSCode).toEqual(pharmacyODSCode)
  })

  it("should include RepeatNo in data item when defined", () => {
    const task = validTask()
    const repeatNo = 1

    task.input = [
      {
        valueInteger: repeatNo,
        type: {
          coding: [
            {
              system: "http://example.com/system",
              code: "repeat-number"
            }
          ]
        }
      }
    ]

    const requestEntry: BundleEntry = {
      resource: task,
      fullUrl: ""
    }

    const dataItems = buildDataItems([requestEntry], "", "")

    expect(dataItems[0].RepeatNo).toEqual(repeatNo)
  })

  it("should add a future dated ExpiryTime", () => {
    const task = validTask()
    // set expected expiry time to be 100 milliseconds in the past
    const expectedExpiryTime = (Math.floor(+new Date() / 1000) + TTL_DELTA) - 100
    const requestEntry: BundleEntry = {
      resource: task,
      fullUrl: ""
    }

    const dataItems = buildDataItems([requestEntry], "", "")

    expect(dataItems[0].ExpiryTime).toBeGreaterThan(expectedExpiryTime)
  })
})
