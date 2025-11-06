/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"
import {jest} from "@jest/globals"
import * as dynamo from "@aws-sdk/client-dynamodb"
import * as sqs from "@aws-sdk/client-sqs"

import {
  LINE_ITEM_ID_CODESYSTEM,
  NHS_NUMBER_CODESYSTEM,
  ODS_CODE_CODESYSTEM,
  PRESCRIPTION_ID_CODESYSTEM,
  STATUS_CODESYSTEM
} from "../../src/validation/content"
import {Task} from "fhir/r4"

import valid from "../tasks/valid.json"
import {PSUDataItem} from "@psu-common/commonTypes"

export const TASK_ID_0 = "4d70678c-81e4-4ff4-8c67-17596fd0aa46"
export const TASK_ID_1 = "0ae4daf3-f24b-479d-b8fa-b69e2d873b60"
export const TASK_ID_2 = "7fa03335-7adf-4090-a9d3-1d20230286cf"
export const TASK_ID_3 = "55f8c42b-26fc-4970-9352-95caf24f0d7e"

const FULL_URL_PREFIX = "urn:uuid:"
export const FULL_URL_0 = FULL_URL_PREFIX + TASK_ID_0
export const FULL_URL_1 = FULL_URL_PREFIX + TASK_ID_1
export const FULL_URL_2 = FULL_URL_PREFIX + TASK_ID_2
export const FULL_URL_3 = FULL_URL_PREFIX + TASK_ID_3

export const X_REQUEST_ID = "43313002-debb-49e3-85fa-34812c150242"
export const APPLICATION_NAME = "test-app"
export const DEFAULT_DATE = new Date("2023-09-11T10:11:12Z")

const DEFAULT_HEADERS = {"x-request-id": X_REQUEST_ID, "attribute-name": APPLICATION_NAME}
const TABLE_NAME = "PrescriptionStatusUpdates"

export const TASK_VALUES = [
  {
    prescriptionID: "07A66F-A83008-1EEEA0",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "6989B7BD-8DB6-428C-A593-4022E3044C00",
    id: TASK_ID_0,
    status: "completed",
    businessStatus: "Dispatched",
    lastModified: "2023-09-11T10:11:12Z"
  },
  {
    prescriptionID: "480720-A83008-57FF06",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "E3843418-1900-44A1-8F6A-BFF8601893B8",
    id: TASK_ID_1,
    status: "in-progress",
    businessStatus: "Ready to collect",
    lastModified: "2023-09-11T10:11:12Z"
  },
  {
    prescriptionID: "EF0871-A83008-A5797M",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "9681AE97-F7E4-44D8-A818-898E9E60EBFC",
    id: TASK_ID_2,
    status: "completed",
    businessStatus: "Dispatched",
    lastModified: "2023-09-11T10:11:12Z"
  },
  {
    prescriptionID: "01F864-A83008-B373F0",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "E15CEDB6-EBD2-481B-A3A2-BCAEFF3940E9",
    id: TASK_ID_3,
    status: "in-progress",
    businessStatus: "Ready to collect",
    lastModified: "2023-09-11T10:11:12Z"
  }
]

export function deepCopy(toCopy: object) {
  return JSON.parse(JSON.stringify(toCopy))
}

export function validTask(): Task {
  const task: any = deepCopy(valid)
  return task as Task
}

export const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: body,
  headers: DEFAULT_HEADERS,
  multiValueHeaders: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/",
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: "",
  pathParameters: null
})

export function generateEntry(index: number) {
  const values = TASK_VALUES[index]
  return {
    fullUrl: FULL_URL_PREFIX + values.id,
    resource: {
      resourceType: "Task",
      lastModified: values.lastModified,
      focus: {identifier: {value: values.lineItemID, system: LINE_ITEM_ID_CODESYSTEM}},
      for: {identifier: {value: values.nhsNumber, system: NHS_NUMBER_CODESYSTEM}},
      owner: {identifier: {value: values.odsCode, system: ODS_CODE_CODESYSTEM}},
      basedOn: [{identifier: {value: values.prescriptionID, system: PRESCRIPTION_ID_CODESYSTEM}}],
      businessStatus: {coding: [{code: values.businessStatus, system: STATUS_CODESYSTEM}]},
      id: values.id,
      status: values.status
    }
  }
}

export function generateBody(taskCount: number = 1) {
  const entries = []
  for (let i = 0; i < taskCount; i++) {
    entries.push(generateEntry(i))
  }
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries
  }
}

export function generateExpectedItems(itemCount: number = 1) {
  const items = []
  for (let i = 0; i < itemCount; i++) {
    const values = TASK_VALUES[i]
    items.push({
      Put: {
        TableName: TABLE_NAME,
        ConditionExpression: "attribute_not_exists(TaskID) AND attribute_not_exists(PrescriptionID)",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        Item: expect.objectContaining({
          LastModified: {S: values.lastModified},
          LineItemID: {S: values.lineItemID},
          PatientNHSNumber: {S: values.nhsNumber},
          PharmacyODSCode: {S: values.odsCode},
          PrescriptionID: {S: values.prescriptionID},
          Status: {S: values.businessStatus},
          TaskID: {S: values.id},
          TerminalStatus: {S: values.status},
          RequestID: {S: X_REQUEST_ID},
          ApplicationName: {S: APPLICATION_NAME}
        })
      }
    })
  }
  return {input: {TransactItems: items}}
}

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockInternalDependency(modulePath: string, module: object, dependency: string) {
  const mockDependency = jest.fn()
  jest.unstable_mockModule(modulePath, () => ({
    ...module,
    [dependency]: mockDependency
  }))
  return mockDependency
}

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockDynamoDBClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-dynamodb", () => {
    return {
      ...dynamo,
      DynamoDBClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

// Similarly mock the SQS client
export function mockSQSClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-sqs", () => {
    return {
      ...sqs,
      SQSClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

export function createMockDataItem(overrides: Partial<PSUDataItem>): PSUDataItem {
  return {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "mnopqr-ghijkl-abcdef",
    TerminalStatus: "ready to collect",
    ApplicationName: "Internal Test System",
    ExpiryTime: 123,
    ...overrides
  }
}

// Mock implementation for getTestPrescriptions and desired returns for input parameters
const mockPrescriptions = new Map([
  ["TEST_PRESCRIPTIONS_PARAM_1", [TASK_VALUES[1].prescriptionID]],
  ["TEST_PRESCRIPTIONS_PARAM_2", [TASK_VALUES[3].prescriptionID]],
  ["TEST_PRESCRIPTIONS_PARAM_3", [TASK_VALUES[2].prescriptionID]],
  ["TEST_PRESCRIPTIONS_PARAM_4", [TASK_VALUES[0].prescriptionID]]
])

export const getTestPrescriptions = jest.fn()
  .mockName("getTestPrescriptions")
  .mockImplementation((param: unknown) => {
    return Promise.resolve(mockPrescriptions.get(param as string) || [])
  })
