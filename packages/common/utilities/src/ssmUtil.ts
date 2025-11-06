import {SSMProvider} from "@aws-lambda-powertools/parameters/ssm"

export const initiatedSSMProvider = new SSMProvider({
  clientConfig: {region: process.env.AWS_REGION || "eu-west-2"}
})
