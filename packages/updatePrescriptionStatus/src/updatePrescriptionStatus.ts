/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"
import {Bundle, BundleEntry, Task} from "fhir/r4"

import {PSUDataItem, PSUDataItemWithPrevious} from "@psu-common/commonTypes"

import {transactionBundle, validateEntry} from "./validation/content"
import {getPreviousItem, persistDataItems, rollbackDataItems} from "./utils/databaseClient"
import {jobWithTimeout, hasTimedOut} from "./utils/timeoutUtils"
import {pushPrescriptionToNotificationSQS} from "./utils/sqsClient"
import {
  accepted,
  badRequest,
  bundleWrap,
  conflictDuplicate,
  createSuccessResponseEntries,
  serverError,
  timeoutResponse,
  tooManyRequests
} from "./utils/responses"
import {
  InterceptionResult,
  testPrescription1Intercept,
  testPrescription2Intercept
} from "./utils/testPrescriptionIntercept"
import {getTestPrescriptions, initiatedSSMProvider} from "@psu-common/utilities"

export const LAMBDA_TIMEOUT_MS = 9500
// this is length of time from now when records in dynamodb will automatically be expired
export const TTL_DELTA = 60 * 60 * 24 * 365 * 2 // Keep records for 2 years
export const logger = new Logger({serviceName: "updatePrescriptionStatus"})

// Fetching the parameters from SSM using a dedicated provider, so that the values can be cached
// and reused across invocations, reducing the number of calls to SSM.
// (it was failing load tests using getParameter directly)
const ssm = initiatedSSMProvider

async function loadConfig() {
  const paramNames = {
    [process.env.ENABLE_NOTIFICATIONS_PARAM!]: {maxAge: 5}
  }
  const all = await ssm.getParametersByName(paramNames)

  const enableNotificationsValue = (all[process.env.ENABLE_NOTIFICATIONS_PARAM!] as string)
    .toString()
    .trim()
    .toLowerCase()

  return {
    enableNotifications: enableNotificationsValue === "true"
  }
}

// AEA-4317 AEA-4365 & AEA-5913 - Env vars for INT test prescriptions
const INT_ENVIRONMENT = process.env.ENVIRONMENT === "int"
// Using lazy initialization to avoid top-level await issues with Jest mocking
export let TEST_PRESCRIPTIONS_1: Array<string> = []
export let TEST_PRESCRIPTIONS_2: Array<string> = []
export let TEST_PRESCRIPTIONS_3: Array<string> = []
export let TEST_PRESCRIPTIONS_4: Array<string> = []

let testPrescriptionsLoaded = false
async function loadTestPrescriptions() {
  if (!testPrescriptionsLoaded) {
    TEST_PRESCRIPTIONS_1 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_1")
    TEST_PRESCRIPTIONS_2 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_2")
    TEST_PRESCRIPTIONS_3 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_3")
    TEST_PRESCRIPTIONS_4 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_4")
    testPrescriptionsLoaded = true
  }
}

// Export for testing purposes - allows tests to reset the loaded state
export function resetTestPrescriptions() {
  testPrescriptionsLoaded = false
  TEST_PRESCRIPTIONS_1 = []
  TEST_PRESCRIPTIONS_2 = []
  TEST_PRESCRIPTIONS_3 = []
  TEST_PRESCRIPTIONS_4 = []
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
    "nhsd-request-id": event.headers["nhsd-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"]
  })
  let responseEntries: Array<BundleEntry> = []

  // Proxygen can't check for this in a granular enough way (it cannot be on the notify callback)
  // So check manually here.
  if ((!event.headers["attribute-name"]) && (process.env.REQUIRE_APPLICATION_NAME?.toLocaleLowerCase() === "true")) {
    logger.error("Missing `attribute-name` in request headers, and it is required in this environment")
    return response(400, responseEntries)
  }

  const xRequestID = getXRequestID(event, responseEntries)
  const applicationName = event.headers["attribute-name"] ?? "unknown"

  if (!xRequestID) {
    return response(400, responseEntries)
  }
  logger.appendKeys({
    "x-request-id": xRequestID
  })

  const requestBody = event.body
  const requestBundle = castEventBody(requestBody, responseEntries)
  if (!requestBundle) {
    return response(400, responseEntries)
  }

  const requestEntries: Array<BundleEntry> = requestBundle.entry || []

  if (requestEntries.length === 0) {
    logger.info("No entries to process.")
    return response(200, responseEntries)
  }
  const entriesValid = validateEntries(requestEntries, responseEntries)
  if (!entriesValid) {
    return response(400, responseEntries)
  }

  const dataItems = buildDataItems(requestEntries, xRequestID, applicationName)

  // If the dataItems contain any invalid ODS codes, then return an error
  const invalidODSCodes = dataItems
    .filter(item => {
      const odsCode = item.PharmacyODSCode
      if (!odsCode || !/^[A-Z0-9]+$/.test(odsCode)) return true
      return false
    })
    .map(it => it.PharmacyODSCode)
  if (invalidODSCodes.length) {
    logger.error("Received invalid ODS codes", {invalidODSCodes})
    responseEntries = [badRequest(`Received invalid ODS codes: ${JSON.stringify(invalidODSCodes)}`)]
    return response(400, responseEntries)
  }

  // AEA-4317 (AEA-4365) - Intercept INT test prescriptions
  let testPrescription1Forced201 = false
  let testPrescriptionForcedError = false
  if (INT_ENVIRONMENT) {
    logger.info("INT environment detected, checking for test prescription interceptions.")
    await loadTestPrescriptions()
    let interceptionResponse: InterceptionResult = {}
    const prescriptionIDs = dataItems.map((item) => item.PrescriptionID)
    const taskIDs = dataItems.map((item) => item.TaskID)

    const testPrescription1Index = prescriptionIDs.findIndex((id) => TEST_PRESCRIPTIONS_1.includes(id))
    const isTestPrescription1 = testPrescription1Index !== -1
    if (isTestPrescription1) {
      const taskID = taskIDs[testPrescription1Index]
      const matchingPrescription1ID = prescriptionIDs[testPrescription1Index]
      interceptionResponse = await testPrescription1Intercept(logger, matchingPrescription1ID, taskID)
    }

    const testPrescription2Index = prescriptionIDs.findIndex((id) => TEST_PRESCRIPTIONS_2.includes(id))
    const isTestPrescription2 = testPrescription2Index !== -1
    if (isTestPrescription2) {
      const taskID = taskIDs[testPrescription2Index]
      const matchingPrescription2ID = prescriptionIDs[testPrescription2Index]
      interceptionResponse = await testPrescription2Intercept(logger, matchingPrescription2ID, taskID)
    }

    const testPrescription3Index = prescriptionIDs.findIndex((id) => TEST_PRESCRIPTIONS_3.includes(id))
    const isTestPrescription3 = testPrescription3Index !== -1
    if (isTestPrescription3) {
      logger.info("Forcing error for INT test prescription. Simulating failure to write to database.")
      responseEntries = [badRequest(`Simulated failure to write to database for test prescription.`)]
      return response(400, responseEntries)
    }

    const testPrescription4Index = prescriptionIDs.findIndex((id) => TEST_PRESCRIPTIONS_4.includes(id))
    const isTestPrescription4 = testPrescription4Index !== -1
    if (isTestPrescription4) {
      logger.info("Forcing error for INT test prescription. Simulating PSU capacity failure.")
      responseEntries = [tooManyRequests()]
      return response(429, responseEntries)
    }

    testPrescription1Forced201 = !!interceptionResponse.testPrescription1Forced201
    testPrescriptionForcedError = !!interceptionResponse.testPrescriptionForcedError
  }

  let dataItemsWithPrev = []
  try {
    dataItemsWithPrev = await Promise.all(dataItems.map((item) => getPreviousItem(item, logger)))
  } catch (e) {
    logger.error("Error getting previous data items from data store.", {error: e})
    dataItemsWithPrev = dataItems.map((item) => {
      return {current: item, previous: undefined}
    })
  }
  await logTransitions(dataItemsWithPrev)

  // Await the parameter promise before we continue
  let enableNotificationsFlag = false
  try {
    const {enableNotifications} = await loadConfig()
    enableNotificationsFlag = enableNotifications
  } catch (err) {
    logger.error("Failed to load parameters from SSM", {err})
  }

  try {
    const persistSuccess = persistDataItems(dataItems, logger)
    const persistResponse = await jobWithTimeout(LAMBDA_TIMEOUT_MS, persistSuccess)

    if (hasTimedOut(persistResponse)) {
      responseEntries = [timeoutResponse()]
      logger.error("DynamoDB operation timed out.")
      return response(504, responseEntries)
    }

    if (!persistResponse) {
      responseEntries = [serverError()]
      return response(500, responseEntries)
    }

    responseEntries = createSuccessResponseEntries(requestEntries)
    logger.info("Event processed successfully.")
  } catch (e) {
    if (e instanceof TransactionCanceledException) {
      // AEA-4317 - Forcing 201 response for INT test prescription 1
      if (testPrescription1Forced201) {
        logger.info("Forcing 201 response for INT test prescription 1")
        responseEntries = createSuccessResponseEntries(requestEntries)
        // Don't attempt to send notifications for these test prescriptions
        return response(201, responseEntries)
      }

      handleTransactionCancelledException(e, responseEntries)
      return response(409, responseEntries)
    }
  }

  // AEA-4317 - Forcing error for INT test prescription
  if (testPrescriptionForcedError) {
    logger.info("Forcing error for INT test prescription")
    responseEntries = [serverError()]
    return response(500, responseEntries)
  }

  // If all the PSU stuff went well, then send the notification requests out
  if (enableNotificationsFlag) {
    try {
      const requestId = event.headers["x-request-id"] ?? "x-request-id-not-found"
      await pushPrescriptionToNotificationSQS(requestId, dataItemsWithPrev, logger)
    } catch (err) {
      logger.error("Failed to push prescriptions to the notifications SQS", {err})
      // We're considering this a bust, and if they send a retry before undoing the table
      // bits then they will get a collision. Delete the newly created records then return the error
      await rollbackDataItems(dataItems, logger)
      responseEntries = [serverError()]
      return response(500, responseEntries)
    }
  } else {
    logger.info(
      "enableNotifications is not true, skipping the notification request.",
      {enableNotificationsFlag}
    )
  }

  return response(201, responseEntries)
}

export function getXRequestID(event: APIGatewayProxyEvent, responseEntries: Array<BundleEntry>): string | undefined {
  const xRequestID = event.headers["x-request-id"]
  if (!xRequestID) {
    const errorMessage = "Missing or empty x-request-id header."
    logger.error(errorMessage)
    const entry: BundleEntry = badRequest(errorMessage)
    responseEntries.push(entry)
    return undefined
  }
  return xRequestID
}

export function castEventBody(body: any, responseEntries: Array<BundleEntry>): Bundle | undefined {
  if (transactionBundle(body)) {
    return body as Bundle
  } else {
    const errorMessage = "Request body does not have resourceType of 'Bundle' and type of 'transaction'."
    logger.error(errorMessage)
    const entry: BundleEntry = badRequest(errorMessage)
    responseEntries.push(entry)
  }
}

export function validateEntries(requestEntries: Array<BundleEntry>, responseEntries: Array<BundleEntry>): boolean {
  logger.info("Validating entries.")
  let valid = true
  for (const entry of requestEntries) {
    const fullUrl = entry.fullUrl!
    logger.debug("Validating entry.", {entry: entry, id: entry.fullUrl})

    const validationOutcome = validateEntry(entry)

    let responseEntry: BundleEntry
    if (validationOutcome.valid) {
      logger.debug("Entry validated successfully.", {entry: entry, id: entry.fullUrl})
      responseEntry = accepted(fullUrl)
    } else {
      const errorMessage = validationOutcome.issues!
      logger.warn(`Entry failed validation. ${errorMessage}`, {entry: entry, id: entry.fullUrl})
      valid = false
      responseEntry = badRequest(errorMessage, fullUrl)
    }
    responseEntries.push(responseEntry)
  }
  logger.info("Entries validated.")
  return valid
}

export function handleTransactionCancelledException(
  e: TransactionCanceledException,
  responseEntries: Array<BundleEntry>
): void {
  const taskIdSet = new Set<string>()

  e.CancellationReasons?.forEach((reason) => {
    const taskId = reason.Item?.TaskID?.S
    if (taskId) {
      const conflictedEntry = conflictDuplicate(taskId)

      const index = responseEntries.findIndex((entry) => {
        const entryTaskId = entry.response?.location?.split("/").pop() ?? entry.fullUrl?.split(":").pop()
        return entryTaskId === taskId
      })

      if (index !== -1) {
        responseEntries[index] = conflictedEntry
      } else {
        responseEntries.push(conflictedEntry)
      }

      taskIdSet.add(taskId)
    }
  })

  responseEntries = responseEntries.filter((entry) => {
    const taskId = entry.fullUrl?.split(":").pop()
    return !taskId || !taskIdSet.has(taskId) || entry.response?.status !== "200 OK"
  })
}

export function buildDataItems(
  requestEntries: Array<BundleEntry>,
  xRequestID: string,
  applicationName: string
): Array<PSUDataItem> {
  const dataItems: Array<PSUDataItem> = []

  for (const requestEntry of requestEntries) {
    const task = requestEntry.resource as Task
    logger.debug("Building data item for task.", {task: task, id: task.id})

    const repeatNo = task.input?.[0]?.valueInteger

    const dataItem: PSUDataItem = {
      LastModified: task.lastModified!,
      LineItemID: task.focus!.identifier!.value!.toUpperCase(),
      PatientNHSNumber: task.for!.identifier!.value!,
      PharmacyODSCode: task.owner!.identifier!.value!.toUpperCase().trim(),
      PrescriptionID: task.basedOn![0].identifier!.value!.toUpperCase(),
      ...(repeatNo !== undefined && {RepeatNo: repeatNo}),
      RequestID: xRequestID,
      Status: task.businessStatus!.coding![0].code!,
      TaskID: task.id!,
      TerminalStatus: task.status,
      ApplicationName: applicationName,
      ExpiryTime: (Math.floor(+new Date() / 1000) + TTL_DELTA)
    }

    dataItems.push(dataItem)
  }
  return dataItems
}

function response(statusCode: number, responseEntries: Array<BundleEntry>) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(bundleWrap(responseEntries)),
    headers: {
      "Content-Type": "application/fhir+json",
      "Cache-Control": "no-cache"
    }
  }
}

async function logTransitions(dataItems: Array<PSUDataItemWithPrevious>): Promise<void> {
  for (const el of dataItems) {
    const currentItem = el.current
    const previousItem = el.previous

    try {
      if (previousItem) {
        const newDate = new Date(currentItem.LastModified)
        const previousDate = new Date(previousItem.LastModified)
        logger.info("Transitioning item status.", {
          prescriptionID: currentItem.PrescriptionID,
          lineItemID: currentItem.LineItemID,
          nhsNumber: currentItem.PatientNHSNumber,
          pharmacyODSCode: currentItem.PharmacyODSCode,
          applicationName: currentItem.ApplicationName,
          when: currentItem.LastModified,
          interval: (newDate.valueOf() - previousDate.valueOf()) / 1000,
          newStatus: currentItem.Status,
          previousStatus: previousItem.Status,
          newTerminalStatus: currentItem.TerminalStatus,
          previousTerminalStatus: previousItem.TerminalStatus
        })
      }
    } catch (e) {
      logger.error("Error logging transition.", {taskID: currentItem.TaskID, error: e})
    }
  }
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(httpHeaderNormalizer())
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(errorHandler({logger: logger}))
