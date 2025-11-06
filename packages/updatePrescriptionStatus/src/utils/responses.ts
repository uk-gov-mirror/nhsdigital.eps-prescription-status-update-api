import {Bundle, BundleEntry} from "fhir/r4"

export function bundleWrap(entries: Array<BundleEntry>): Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: entries
  }
}

export function badRequest(diagnostics: string, fullUrl: string | undefined = undefined): BundleEntry {
  const bundleEntry: BundleEntry = {
    response: {
      status: "400 Bad Request",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "value",
            severity: "error",
            diagnostics: diagnostics
          }
        ]
      }
    }
  }
  if (fullUrl) {
    bundleEntry.fullUrl = fullUrl
  }
  return bundleEntry
}

export function tooManyRequests(): BundleEntry {
  return {
    response: {
      status: "429 Too Many Requests",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "temporarily-forbidden",
            severity: "error"
          }
        ]
      }
    }
  }
}

export function timeoutResponse(): BundleEntry {
  return {
    response: {
      status: "504 The request timed out",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "timeout",
            severity: "fatal",
            diagnostics: "The Server has timed out while processing the request sent by the client."
          }
        ]
      }
    }
  }
}

export function accepted(fullUrl: string): BundleEntry {
  return {
    fullUrl: fullUrl,
    response: {
      status: "200 OK",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "informational",
            severity: "information",
            diagnostics: "Data not committed due to issues in other entries."
          }
        ]
      }
    }
  }
}

function created(fullUrl: string): BundleEntry {
  return {
    fullUrl: fullUrl,
    response: {
      status: "201 Created",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "success",
            severity: "information",
            diagnostics: "No issues detected during validation."
          }
        ]
      }
    }
  }
}

export function serverError(): BundleEntry {
  return {
    response: {
      status: "500 Internal Server Error",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "exception",
            severity: "fatal",
            diagnostics: "The Server has encountered an error processing the request."
          }
        ]
      }
    }
  }
}

export function conflictDuplicate(taskId: string): BundleEntry {
  return {
    response: {
      status: "409 Conflict",
      location: `Task/${taskId}`,
      lastModified: new Date().toISOString(),
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "duplicate",
            severity: "error",
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                  code: "REC_CONFLICT",
                  display: "409: The Receiver identified a conflict."
                }
              ]
            },
            diagnostics:
              "Request contains a task id and prescription id identical to a record already in the data store."
          }
        ]
      }
    }
  }
}

export function createSuccessResponseEntries(entries: Array<BundleEntry>) {
  return entries.map((e) => created(e.fullUrl!))
}
