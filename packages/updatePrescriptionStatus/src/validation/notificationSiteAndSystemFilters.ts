import {PSUDataItemWithPrevious} from "@psu-common/commonTypes"
import {initiatedSSMProvider} from "@psu-common/utilities"
import {Logger} from "@aws-lambda-powertools/logger"

function str2set(value: string | undefined): Set<string> {
  const raw = value ?? ""
  return new Set(raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) // Remove empty entries
  )
}

async function loadConfig(): Promise<{
  enabledSiteODSCodes: Set<string>,
  enabledSystems: Set<string>,
  blockedSiteODSCodes: Set<string>
}> {
  const paramNames = {
    [process.env.ENABLED_SITE_ODS_CODES_PARAM!]: {maxAge: 5},
    [process.env.ENABLED_SYSTEMS_PARAM!]: {maxAge: 5},
    [process.env.BLOCKED_SITE_ODS_CODES_PARAM!]: {maxAge: 5}
  }
  const all = await initiatedSSMProvider.getParametersByName(paramNames)

  const enabledSiteODSCodes = str2set(all[process.env.ENABLED_SITE_ODS_CODES_PARAM!] as string)
  const enabledSystems = str2set(all[process.env.ENABLED_SYSTEMS_PARAM!] as string)
  const blockedSiteODSCodes = str2set(all[process.env.BLOCKED_SITE_ODS_CODES_PARAM!] as string)

  return {
    enabledSiteODSCodes,
    enabledSystems,
    blockedSiteODSCodes
  }
}

/**
 * Given an array of PSUDataItem, only returns those which:
 * - ARE enabled at a site OR system level,
 * - AND are NOT blocked at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @param logger - Optional logger instance
 * @returns - the filtered array
 */
export async function checkSiteOrSystemIsNotifyEnabled(
  data: Array<PSUDataItemWithPrevious>,
  logger?: Logger
): Promise<Array<PSUDataItemWithPrevious>> {
  // Get the configuration from either the cache or SSM
  const {enabledSiteODSCodes, enabledSystems, blockedSiteODSCodes} = await loadConfig()
  const unfilteredItemCount = data.length

  const filteredItems = data.filter((item) => {
    const appName = item.current.ApplicationName.trim().toLowerCase()
    const odsCode = item.current.PharmacyODSCode.trim().toLowerCase()

    // Is this item either ODS enabled, or supplier enabled?
    const isEnabledSystem = enabledSiteODSCodes.has(odsCode) || enabledSystems.has(appName)
    if (!isEnabledSystem) {
      return false
    }

    // Cannot have a blocked ODS code
    if (blockedSiteODSCodes.has(odsCode)) {
      return false
    }

    return true
  })

  if (logger) {
    logger.info(
      "Filtered out sites and suppliers that are not enabled, or are explicitly disabled",
      {numItemsReceived: unfilteredItemCount, numItemsAllowed: filteredItems.length}
    )
  }

  return filteredItems
}
