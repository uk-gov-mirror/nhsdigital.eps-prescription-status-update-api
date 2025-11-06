#!/usr/bin/env bash

AWS_MAX_ATTEMPTS=20
export AWS_MAX_ATTEMPTS

echo "$COMMIT_ID"

CF_LONDON_EXPORTS=$(aws cloudformation list-exports --region eu-west-2 --output json)
artifact_bucket_arn=$(echo "$CF_LONDON_EXPORTS" | \
    jq \
    --arg EXPORT_NAME "account-resources:ArtifactsBucket" \
    -r '.Exports[] | select(.Name == $EXPORT_NAME) | .Value')
artifact_bucket=$(echo "$artifact_bucket_arn" | cut -d: -f6 | cut -d/ -f1)
export artifact_bucket

cloud_formation_execution_role=$(echo "$CF_LONDON_EXPORTS" | \
    jq \
    --arg EXPORT_NAME "ci-resources:CloudFormationExecutionRole" \
    -r '.Exports[] | select(.Name == $EXPORT_NAME) | .Value')

if [ -z "${cloud_formation_execution_role}" ]; then
    echo "could not retrieve ROLE from aws cloudformation list-exports"
    exit 1
fi
export cloud_formation_execution_role

TRUSTSTORE_BUCKET_ARN=$(aws cloudformation describe-stacks --stack-name account-resources --query "Stacks[0].Outputs[?OutputKey=='TrustStoreBucket'].OutputValue" --output text)
TRUSTSTORE_BUCKET_NAME=$(echo "${TRUSTSTORE_BUCKET_ARN}" | cut -d ":" -f 6)
LATEST_TRUSTSTORE_VERSION=$(aws s3api list-object-versions --bucket "${TRUSTSTORE_BUCKET_NAME}" --prefix "${TRUSTSTORE_FILE}" --query 'Versions[?IsLatest].[VersionId]' --output text)
export LATEST_TRUSTSTORE_VERSION

cd ../../.aws-sam/build || exit

REPO=eps-prescription-status-update-api
CFN_DRIFT_DETECTION_GROUP="psu"
if [[ "$STACK_NAME" =~ -pr-[0-9]+$ ]]; then
  CFN_DRIFT_DETECTION_GROUP="psu-pull-request"
fi

sam deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    --region eu-west-2 \
    --s3-bucket "$artifact_bucket" \
    --s3-prefix "$ARTIFACT_BUCKET_PREFIX" \
    --config-file samconfig_package_and_deploy.toml \
    --no-fail-on-empty-changeset \
    --role-arn "$cloud_formation_execution_role" \
    --no-confirm-changeset \
    --force-upload \
    --tags "version=$VERSION_NUMBER stack=$STACK_NAME repo=$REPO cfnDriftDetectionGroup=$CFN_DRIFT_DETECTION_GROUP" \
    --parameter-overrides \
            TruststoreVersion="$LATEST_TRUSTSTORE_VERSION" \
            EnableMutualTLS="$ENABLE_MUTUAL_TLS" \
            EnableSplunk=true \
            EnableDynamoDBAutoScaling="$DYNAMODB_AUTOSCALE" \
            VersionNumber="$VERSION_NUMBER" \
            CommitId="$COMMIT_ID" \
            LogLevel="$LOG_LEVEL" \
            LogRetentionInDays="$LOG_RETENTION_DAYS" \
            Environment="$TARGET_ENVIRONMENT" \
            DeployCheckPrescriptionStatusUpdate="$DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE" \
            EnableAlerts="$ENABLE_ALERTS" \
            StateMachineLogLevel="$STATE_MACHINE_LOG_LEVEL" \
            EnableNotificationsInternal="$ENABLE_NOTIFICATIONS_INTERNAL" \
            EnableNotificationsExternal="$ENABLE_NOTIFICATIONS_EXTERNAL" \
            EnabledSiteODSCodesValue="${ENABLED_SITE_ODS_CODES:-' '}" \
            EnabledSystemsValue="${ENABLED_SYSTEMS:-' '}" \
            BlockedSiteODSCodesValue="${BLOCKED_SITE_ODS_CODES:-' '}" \
            NotifyRoutingPlanIDValue="$NOTIFY_ROUTING_PLAN_ID" \
            NotifyAPIBaseURLValue="$NOTIFY_API_BASE_URL" \
            RequireApplicationName="$REQUIRE_APPLICATION_NAME" \
            EnableBackup="$ENABLE_BACKUP" \
            TestPresciptionsParamValue1="$TEST_PRESCRIPTIONS_1" \
            TestPresciptionsParamValue2="$TEST_PRESCRIPTIONS_2" \
            TestPresciptionsParamValue3="$TEST_PRESCRIPTIONS_3" \
            TestPresciptionsParamValue4="$TEST_PRESCRIPTIONS_4" \
            ForwardCsocLogs="$FORWARD_CSOC_LOGS"
