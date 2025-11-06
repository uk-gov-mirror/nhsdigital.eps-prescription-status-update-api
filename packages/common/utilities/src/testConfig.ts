import {initiatedSSMProvider} from "./ssmUtil"

export interface TestPrescriptionsConfig {
  getTestPrescriptions(param: keyof typeof TestPrescriptions): Promise<Array<string>>
}

export class TestPrescriptions implements TestPrescriptionsConfig {
  // Parameter names via environment variables for test prescriptions
  // or default names if environment variables are not set for testing
  // environment variables set by SSM parameter resource name defined in SAM template
  static readonly TEST_PRESCRIPTIONS_PARAM_1 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_1 || "TEST_PRESCRIPTIONS_1")
  static readonly TEST_PRESCRIPTIONS_PARAM_2 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_2 || "TEST_PRESCRIPTIONS_2")
  static readonly TEST_PRESCRIPTIONS_PARAM_3 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_3 || "TEST_PRESCRIPTIONS_3")
  static readonly TEST_PRESCRIPTIONS_PARAM_4 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_4 || "TEST_PRESCRIPTIONS_4")

  private ssmProvider

  constructor(ssmProvider: typeof initiatedSSMProvider) {
    this.ssmProvider = ssmProvider
  }

  async getTestPrescriptions(param: keyof typeof TestPrescriptions): Promise<Array<string>> {
    const paramName = (TestPrescriptions[param] as string)
    const prescriptions = new Array<string>()

    const paramValues = await this.ssmProvider.get(paramName) as string

    if (paramValues.length > 0) {
      paramValues
        .toString()
        .split(",")
        .map(p => p.trim())
        .forEach(p => prescriptions.push(p))
    } else {
      return []
    }

    return prescriptions
  }
}

export const testPrescriptionsConfig = new TestPrescriptions(initiatedSSMProvider)
export const getTestPrescriptions = testPrescriptionsConfig.getTestPrescriptions.bind(testPrescriptionsConfig)
