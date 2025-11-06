/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {
  APPLICATION_NAME,
  DEFAULT_DATE,
  FULL_URL_0,
  FULL_URL_1,
  generateBody,
  generateExpectedItems,
  generateMockEvent,
  mockDynamoDBClient,
  TASK_VALUES,
  getTestPrescriptions
} from "./utils/testUtils"

import requestDispatched from "../../specification/examples/request-dispatched.json"
import requestMultipleItems from "../../specification/examples/request-multiple-items.json"
import requestMissingFields from "../../specification/examples/request-missing-fields.json"
import requestMultipleMissingFields from "../../specification/examples/request-multiple-missing-fields.json"
import requestNoItems from "../../specification/examples/request-no-items.json"
import requestDuplicateItems from "../../specification/examples/request-duplicate-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"
import {
  badRequest,
  bundleWrap,
  serverError,
  timeoutResponse
} from "../src/utils/responses"
import {QueryCommand, TransactionCanceledException, TransactWriteItemsCommand} from "@aws-sdk/client-dynamodb"

const {mockSend: dynamoDBMockSend} = mockDynamoDBClient()

const mockPushPrescriptionToNotificationSQS = jest.fn().mockImplementation(async () => Promise.resolve())
jest.unstable_mockModule("../src/utils/sqsClient", async () => ({
  __esModule: true,
  pushPrescriptionToNotificationSQS: mockPushPrescriptionToNotificationSQS
}))

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

const {handler, logger} = await import("../src/updatePrescriptionStatus")

const LAMBDA_TIMEOUT_MS = 9500 // 9.5 sec

const ORIGINAL_ENV = {...process.env}

describe("Integration tests for updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    process.env = {...ORIGINAL_ENV}
    jest.clearAllMocks()
    jest.resetAllMocks()
    jest.clearAllTimers()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when request doesn't have correct resourceType and type, expect 400 status code and appropriate message", async () => {
    const body = {resourceType: "NotBundle", type: "not_transaction"}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([
        badRequest(
          "Request body does not have resourceType of 'Bundle' and type of 'transaction'."
        )
      ])
    )
  })

  it("when single item in request, expect a single item sent to DynamoDB", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)

    expect(dynamoDBMockSend).toHaveBeenCalledWith(
      expect.objectContaining(expectedItems)
    )
  })

  it("when input field is absent in a single item request, expect DynamoDB item without RepeatNo field", async () => {
    const body = generateBody()
    const entryResource: any = body.entry?.[0]?.resource
    if (entryResource?.input) {
      delete entryResource.input
    }

    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    const transactItem: any =
      expectedItems.input?.TransactItems?.[0]?.Put?.Item
    if (transactItem?.RepeatNo) {
      delete transactItem.RepeatNo
    }

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)

    expect(expectedItems.input.TransactItems[0].Put.Item.RepeatNo).toEqual(undefined)
    expect(dynamoDBMockSend).toHaveBeenCalledWith(
      expect.objectContaining(expectedItems)
    )
  })

  it("when input field is present in a single item request, expect DynamoDB item with RepeatNo field", async () => {
    const body = generateBody()
    const entryResource: any = body.entry?.[0]?.resource
    if (!entryResource.input) {
      entryResource.input = [{valueInteger: 1}]
    }

    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()

    const transactItem: any =
      expectedItems.input?.TransactItems?.[0]?.Put?.Item
    transactItem.RepeatNo = 1

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)

    expect(expectedItems.input.TransactItems[0].Put.Item.RepeatNo).toEqual(1)
    expect(dynamoDBMockSend).toHaveBeenCalledWith(
      expect.objectContaining(expectedItems)
    )
  })

  it("when multiple items in request, expect multiple items sent to DynamoDB in a single call", async () => {
    const body = generateBody(2)
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems(2)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseMultipleItems)

    expect(dynamoDBMockSend).toHaveBeenCalledWith(
      expect.objectContaining(expectedItems)
    )
  })

  it.each([
    {
      example: requestDispatched,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for a single item"
    },
    {
      example: requestMultipleItems,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for multiple items"
    },
    {
      example: requestNoItems,
      httpResponseCode: 200,
      scenarioDescription: "200 status code if there are no entries to process"
    }
  ])(
    "should return $scenarioDescription",
    async ({example, httpResponseCode}) => {
      const event: APIGatewayProxyEvent = generateMockEvent(example)

      const response: APIGatewayProxyResult = await handler(event, {})

      const responseBody = JSON.parse(response.body)
      expect(response.statusCode).toBe(httpResponseCode)
      expect(responseBody).toHaveProperty("resourceType", "Bundle")
      expect(responseBody).toHaveProperty("type", "transaction-response")
    }
  )

  it("when missing fields, expect 400 status code and message indicating missing fields", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(requestMissingFields)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([
        badRequest(
          "Missing required field(s) - PharmacyODSCode, TaskID.",
          FULL_URL_0
        )
      ])
    )
  })

  const testInvalidODSCode = async (invalidODSCode: string, expectedErrorCode: string) => {
    const body = generateBody()
    const entryResource: any = body.entry?.[0]?.resource
    if (entryResource?.owner?.identifier) {
      entryResource.owner.identifier.value = invalidODSCode
    }

    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([
        badRequest(`Received invalid ODS codes: ["${expectedErrorCode}"]`)
      ])
    )
  }

  it("When the ODS code contains a special character, the handler returns a 400 error", async () => {
    await testInvalidODSCode("AB1$%2", "AB1$%2")
  })

  it("When the ODS code is a space character, the handler returns a 400 error", async () => {
    await testInvalidODSCode(" ", "")
  })

  it("when dynamo call fails, expect 500 status code and internal server error message", async () => {
    const event = generateMockEvent(requestDispatched)
    dynamoDBMockSend.mockRejectedValue(new Error() as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([serverError()]))
  })

  it("when data store update times out, expect 504 status code and relevant error message", async () => {
    dynamoDBMockSend.mockImplementation((command) => new Promise((resolve) => {
      if (!(command instanceof TransactWriteItemsCommand)) {
        resolve(false)
      }
      // else leave the promise unresolved to simulate a timeout
    }))

    const event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const eventHandler: Promise<APIGatewayProxyResult> = handler(event, {})

    await jest.advanceTimersByTimeAsync(LAMBDA_TIMEOUT_MS)

    const response = await eventHandler
    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([timeoutResponse()]))
  })

  it("when multiple tasks have missing fields, expect 400 status code and messages indicating missing fields", async () => {
    const body: any = {...requestMultipleMissingFields}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([
        badRequest(
          "Missing required field(s) - PharmacyODSCode, TaskID.",
          FULL_URL_0
        ),
        badRequest("Missing required field(s) - PharmacyODSCode.", FULL_URL_1)
      ])
    )
  })

  it("when x-request-id header is present but empty, expect 400 status code and relevant error message", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    event.headers["x-request-id"] = undefined

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([badRequest("Missing or empty x-request-id header.")])
    )
  })

  it("when x-request-id header is missing, expect 400 status code and relevant error message", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    delete event.headers["x-request-id"]

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([badRequest("Missing or empty x-request-id header.")])
    )
  })

  it("when x-request-id header is mixed case, expect it to work", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    delete event.headers["x-request-id"]
    event.headers["X-Request-id"] = "43313002-debb-49e3-85fa-34812c150242"

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
  })

  it("when duplicates are introduced, expect only 409 status with a message, while the other response gives a 200 with message", async () => {
    const body = generateBody()
    const mockEvent: APIGatewayProxyEvent = generateMockEvent(body)

    dynamoDBMockSend.mockRejectedValue(
      new TransactionCanceledException({
        message:
          "DynamoDB transaction cancelled due to conditional check failure.",
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
      }) as never
    )

    const response: APIGatewayProxyResult = await handler(mockEvent, {})
    const responseBody = JSON.parse(response.body)

    expect(response.statusCode).toBe(409)
    expect(responseBody.entry).toHaveLength(2)

    expect(responseBody.entry[0].fullUrl).toEqual(
      "urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46"
    )
    expect(responseBody.entry[0].response.status).toEqual("200 OK")
    expect(responseBody.entry[0].response.outcome.issue[0].diagnostics).toEqual(
      "Data not committed due to issues in other entries."
    )
    expect(responseBody.entry[1].response.location).toEqual(
      "Task/d70678c-81e4-6665-8c67-17596fd0aa87"
    )
    expect(responseBody.entry[1].response.status).toEqual("409 Conflict")
    expect(responseBody.entry[1].response.outcome.issue[0].diagnostics).toEqual(
      "Request contains a task id and prescription id identical to a record already in the data store."
    )
    expect(responseBody.entry[1].response.status).not.toEqual("200 OK")
  })

  it("when duplicates are introduced without any other entry, expect only 409 status with a message", async () => {
    const mockEvent: APIGatewayProxyEvent = generateMockEvent(
      requestDuplicateItems
    )

    dynamoDBMockSend.mockRejectedValue(
      new TransactionCanceledException({
        message:
          "DynamoDB transaction cancelled due to conditional check failure.",
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
      }) as never
    )

    const response: APIGatewayProxyResult = await handler(mockEvent, {})
    const responseBody = JSON.parse(response.body)

    expect(response.statusCode).toBe(409)
    expect(responseBody.entry).toHaveLength(1)

    expect(responseBody.entry[0].response.location).toEqual(
      "Task/d70678c-81e4-6665-8c67-17596fd0aa87"
    )
    expect(responseBody.entry[0].response.status).toEqual("409 Conflict")
    expect(responseBody.entry[0].response.outcome.issue[0].diagnostics).toEqual(
      "Request contains a task id and prescription id identical to a record already in the data store."
    )
    expect(responseBody.entry[0].response.status).not.toEqual("200 OK")
  })

  function itemQueryResult(taskID: string, status: string, businessStatus: string, lastModified: string) {
    return {
      PrescriptionID: {S: TASK_VALUES[0].prescriptionID},
      PatientNHSNumber: {S: TASK_VALUES[0].nhsNumber},
      PharmacyODSCode: {S: TASK_VALUES[0].odsCode},
      LineItemID: {S: TASK_VALUES[0].lineItemID},
      TaskID: {S: taskID},
      TerminalStatus: {S: status},
      Status: {S: businessStatus},
      LastModified: {S: lastModified}
    }
  }

  it("when updates already exist for an item, logs transitions", async () => {
    const body = generateBody()
    const mockEvent: APIGatewayProxyEvent = generateMockEvent(body)
    const loggerSpy = jest.spyOn(logger, "info")

    dynamoDBMockSend.mockImplementation(
      async (command) => {
        if (command instanceof QueryCommand) {
          return new Object({
            Items: [
              itemQueryResult("71a3cf0d-c096-4b72-be0c-b1dd5f94ab0b", "in-progress", "With Pharmacy", "2023-09-11T10:09:12Z"),
              itemQueryResult("c523a80a-5346-46b3-81d2-a7420959c26b", "in-progress", "Ready to Dispatch", "2023-09-11T10:10:12Z"),
              itemQueryResult(TASK_VALUES[0].id, TASK_VALUES[0].status, TASK_VALUES[0].businessStatus, TASK_VALUES[0].lastModified)
            ]
          })
        }
      }
    )

    const response: APIGatewayProxyResult = await handler(mockEvent, {})

    expect(response.statusCode).toBe(201)
    expect(loggerSpy).toHaveBeenCalledWith(
      "Transitioning item status.",
      {
        prescriptionID: TASK_VALUES[0].prescriptionID,
        lineItemID: TASK_VALUES[0].lineItemID,
        nhsNumber: TASK_VALUES[0].nhsNumber,
        pharmacyODSCode: TASK_VALUES[0].odsCode,
        applicationName: APPLICATION_NAME,
        when: "2023-09-11T10:11:12Z",
        interval: 60,
        newStatus: TASK_VALUES[0].businessStatus,
        previousStatus: "Ready to Dispatch",
        newTerminalStatus: TASK_VALUES[0].status,
        previousTerminalStatus: "in-progress"
      }
    )
  })

  it("when the notification SQS push fails, the response still succeeds", async () => {
    mockGetParametersByName.mockImplementation(async () => {
      return {
        [process.env.ENABLE_NOTIFICATIONS_PARAM!]: "true"
      }
    })
    mockPushPrescriptionToNotificationSQS.mockImplementation(
      async () => {
        throw new Error("Test error")
      }
    )
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    const event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const response: APIGatewayProxyResult = await tmpfn(event, {})
    expect(response.statusCode).toBe(500)
    expect(mockPushPrescriptionToNotificationSQS).toHaveBeenCalled()
  })

  it("when SQS push throws an error, the response still succeeds", async () => {
    mockGetParametersByName.mockImplementation(async () => {
      return {
        [process.env.ENABLE_NOTIFICATIONS_PARAM!]: "true"
      }
    })
    mockPushPrescriptionToNotificationSQS.mockImplementation(
      async () => {
        throw new Error("Test error")
      }
    )
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    const event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const response: APIGatewayProxyResult = await tmpfn(event, {})
    expect(response.statusCode).toBe(500)
    expect(mockPushPrescriptionToNotificationSQS).toHaveBeenCalled()
  })

  it("When the get parameter call throws an error, the request succeeds and the sqs queue is untouched", async () => {
    mockGetParametersByName.mockImplementation(async () => Promise.reject(new Error("Failed")))
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    const rejected_event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const rejected_response: APIGatewayProxyResult = await tmpfn(rejected_event, {})
    expect(rejected_response.statusCode).toBe(201)
    expect(mockPushPrescriptionToNotificationSQS).not.toHaveBeenCalled()
  })

  it("When the enable notifications parameter is false, the push to SQS is skipped", async () => {
    mockGetParametersByName.mockImplementation(async () => {
      return {
        [process.env.ENABLE_NOTIFICATIONS_PARAM!]: "false"
      }
    })
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    const bypass_event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const bypass_response: APIGatewayProxyResult = await tmpfn(bypass_event, {})
    expect(bypass_response.statusCode).toBe(201)
    expect(mockPushPrescriptionToNotificationSQS).not.toHaveBeenCalled()
  })

  it("When the enable notifications parameter is true, the push to SQS is done", async () => {
    mockGetParametersByName.mockImplementation(async () => {
      return {
        [process.env.ENABLE_NOTIFICATIONS_PARAM!]: "true"
      }
    })
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    const successful_event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const successful_response: APIGatewayProxyResult = await tmpfn(successful_event, {})
    expect(successful_response.statusCode).toBe(201)
    expect(mockPushPrescriptionToNotificationSQS).toHaveBeenCalled()
  })

  it("When the application-name header is missing but required, the lambda returns 400", async () => {
    process.env.REQUIRE_APPLICATION_NAME = "TRUE"
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    let event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    event.headers["attribute-name"] = undefined
    const response: APIGatewayProxyResult = await tmpfn(event, {})
    expect(response.statusCode).toBe(400)
  })

  it("When the application-name header is missing and NOT required, the lambda returns 201", async () => {
    process.env.REQUIRE_APPLICATION_NAME = "false"
    const {handler: tmpfn} = await import("../src/updatePrescriptionStatus")

    let event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    event.headers["attribute-name"] = APPLICATION_NAME // explicitly check this is set
    const response: APIGatewayProxyResult = await tmpfn(event, {})
    expect(response.statusCode).toBe(201)
  })
})
