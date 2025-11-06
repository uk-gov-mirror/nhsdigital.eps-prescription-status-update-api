/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  expect,
  describe,
  it,
  jest,
  beforeEach
} from "@jest/globals"

const mockGet = jest.fn()

const mockInitiatedSSMProvider = {
  get: mockGet
}

jest.unstable_mockModule("../src/ssmUtil", () => ({
  initiatedSSMProvider: mockInitiatedSSMProvider
}))

// Define env var before import
process.env.TEST_PRESCRIPTIONS_PARAM_NAME_4 = "psu-stack-test-prescriptions-4"

const {TestPrescriptions, getTestPrescriptions} = await import("../src/testConfig")

describe("Unit tests for TestPrescriptions class", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("getTestPrescriptions method", () => {
    it("returns an array of prescription IDs when SSM parameter contains comma-separated values", async () => {
      const parameterValue = "prescription-1a,prescription-1b,prescription-1c"
      mockGet.mockImplementation(() => Promise.resolve(parameterValue))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_1")

      expect(result).toEqual(["prescription-1a", "prescription-1b", "prescription-1c"])
      expect(mockGet).toHaveBeenCalledWith("TEST_PRESCRIPTIONS_1")
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    it("trims whitespace from prescription IDs", async () => {
      const parameterValue = " prescription-1a , prescription-1b  ,  prescription-1c "
      mockGet.mockImplementation(() => Promise.resolve(parameterValue))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_2")

      expect(result).toEqual(["prescription-1a", "prescription-1b", "prescription-1c"])
      expect(mockGet).toHaveBeenCalledWith("TEST_PRESCRIPTIONS_2")
    })

    it("returns a single prescription ID when SSM parameter contains one value", async () => {
      const parameterValue = "single-prescription-id"
      mockGet.mockImplementation(() => Promise.resolve(parameterValue))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_3")

      expect(result).toEqual(["single-prescription-id"])
      expect(mockGet).toHaveBeenCalledWith("TEST_PRESCRIPTIONS_3")
    })

    it("returns an empty array when SSM parameter is an empty string", async () => {
      mockGet.mockImplementation(() => Promise.resolve(""))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_3")

      expect(result).toEqual([])
      expect(mockGet).toHaveBeenCalledWith("TEST_PRESCRIPTIONS_3")
    })

    it("handles multiple calls with different parameters", async () => {
      mockGet
        .mockImplementationOnce(() => Promise.resolve("prescription-1a,prescription-1b"))
        .mockImplementationOnce(() => Promise.resolve("prescription-2a,prescription-2b,prescription-2c"))

      const result1 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_1")
      const result2 = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_2")

      expect(result1).toEqual(["prescription-1a", "prescription-1b"])
      expect(result2).toEqual(["prescription-2a", "prescription-2b", "prescription-2c"])
      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(mockGet).toHaveBeenNthCalledWith(1, "TEST_PRESCRIPTIONS_1")
      expect(mockGet).toHaveBeenNthCalledWith(2, "TEST_PRESCRIPTIONS_2")
    })

    it("uses environment variable for parameter name when set", async () => {
    //   Environment variable is set at the top of the file
      expect(TestPrescriptions.TEST_PRESCRIPTIONS_PARAM_4).toEqual("psu-stack-test-prescriptions-4")
    })

    it("uses default parameter name when environment variable is not set", async () => {
      expect(TestPrescriptions.TEST_PRESCRIPTIONS_PARAM_1).toEqual("TEST_PRESCRIPTIONS_1")
    })

    it("handles prescription IDs with special characters", async () => {
      const parameterValue = "A1B2C3-123456,DEF456-789012,GHI789-345678"
      mockGet.mockImplementation(() => Promise.resolve(parameterValue))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_1")

      expect(result).toEqual(["A1B2C3-123456", "DEF456-789012", "GHI789-345678"])
    })

    it("handles prescription IDs with uppercase letters", async () => {
      const parameterValue = "PRESCRIPTION-ID-1,PRESCRIPTION-ID-2"
      mockGet.mockImplementation(() => Promise.resolve(parameterValue))

      const result = await getTestPrescriptions("TEST_PRESCRIPTIONS_PARAM_1")

      expect(result).toEqual(["PRESCRIPTION-ID-1", "PRESCRIPTION-ID-2"])
    })
  })
})
