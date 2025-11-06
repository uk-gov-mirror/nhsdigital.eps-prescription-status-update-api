guard-%:
	@ if [ "${${*}}" = "" ]; then \
		echo "Environment variable $* not set"; \
		exit 1; \
	fi

.PHONY: install build test publish release clean

install: install-node install-python install-hooks

install-python:
	poetry install

install-node:
	npm ci --legacy-peer-deps

install-hooks: install-python
	poetry run pre-commit install --install-hooks --overwrite

sam-build: sam-validate compile
	sam build --template-file SAMtemplates/main_template.yaml --region eu-west-2

sam-build-sandbox: sam-validate-sandbox compile
	sam build --template-file SAMtemplates/sandbox_template.yaml --region eu-west-2

sam-run-local: sam-build
	sam local start-api

sam-sync: guard-AWS_DEFAULT_PROFILE guard-stack_name compile
	sam sync \
		--stack-name $$stack_name \
		--watch \
		--template-file SAMtemplates/main_template.yaml \
		--parameter-overrides \
			  EnableSplunk=false \
			  DeployCheckPrescriptionStatusUpdate=true \
			  EnableAlerts=false

sam-deploy: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam deploy \
		--stack-name $$stack_name \
		--parameter-overrides \
			  EnableSplunk=false \
			  DeployCheckPrescriptionStatusUpdate=true \
			  EnableAlerts=false

sam-delete: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam delete --stack-name $$stack_name

sam-list-endpoints: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list endpoints --stack-name $$stack_name

sam-list-resources: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list resources --stack-name $$stack_name

sam-list-outputs: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list stack-outputs --stack-name $$stack_name

sam-validate: 
	sam validate --template-file SAMtemplates/main_template.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/apis/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/apis/api_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/functions/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/functions/lambda_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/tables/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/tables/dynamodb_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/state_machines/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/state_machines/state_machine_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/alarms/main.yaml --region eu-west-2

sam-validate-sandbox:
	sam validate --template-file SAMtemplates/sandbox_template.yaml --region eu-west-2

sam-deploy-package: guard-artifact_bucket guard-artifact_bucket_prefix guard-stack_name guard-template_file guard-cloud_formation_execution_role guard-LATEST_TRUSTSTORE_VERSION guard-enable_mutual_tls guard-DYNAMODB_AUTOSCALE guard-VERSION_NUMBER guard-COMMIT_ID guard-VERSION_NUMBER guard-LOG_RETENTION_DAYS guard-TARGET_ENVIRONMENT
	sam deploy \
		--template-file $$template_file \
		--stack-name $$stack_name \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket $$artifact_bucket \
		--s3-prefix $$artifact_bucket_prefix \
		--config-file samconfig_package_and_deploy.toml \
		--no-fail-on-empty-changeset \
		--role-arn $$cloud_formation_execution_role \
		--no-confirm-changeset \
		--force-upload \
		--tags "version=$$VERSION_NUMBER cloudFormationStack=$$stack_name" \
		--parameter-overrides \
			  TruststoreVersion=$$LATEST_TRUSTSTORE_VERSION \
			  EnableMutualTLS=$$enable_mutual_tls \
			  EnableSplunk=true \
			  EnableDynamoDBAutoScaling=$$DYNAMODB_AUTOSCALE \
			  VersionNumber=$$VERSION_NUMBER \
			  CommitId=$$COMMIT_ID \
			  LogLevel=$$LOG_LEVEL \
			  LogRetentionInDays=$$LOG_RETENTION_DAYS \
			  Environment=$$TARGET_ENVIRONMENT \
			  DeployCheckPrescriptionStatusUpdate=$$DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE \
			  EnableAlerts=$$ENABLE_ALERTS \
			  StateMachineLogLevel=$$STATE_MACHINE_LOG_LEVEL \
			  EnableNotificationsInternal=$$ENABLE_NOTIFICATIONS_INTERNAL \
			  EnableNotificationsExternal=$$ENABLE_NOTIFICATIONS_EXTERNAL \
			  EnableBackup=$$ENABLE_BACKUP

compile-node:
	npx tsc --build tsconfig.build.json

compile-specification:
	npm run resolve --workspace packages/specification/
	npm run resolve-cpsu --workspace packages/specification/

compile: compile-node compile-specification

lint-node: compile-node
	npm run lint --workspace packages/updatePrescriptionStatus
	npm run lint --workspace packages/gsul
	npm run lint --workspace packages/nhsd-psu-sandbox
	npm run lint --workspace packages/statusLambda
	npm run lint --workspace packages/capabilityStatement
	npm run lint --workspace packages/cpsuLambda
	npm run lint --workspace packages/checkPrescriptionStatusUpdates
	npm run lint --workspace packages/nhsNotifyLambda
	npm run lint --workspace packages/nhsNotifyUpdateCallback
	npm run lint --workspace packages/common/testing
	npm run lint --workspace packages/common/middyErrorHandler
	npm run lint --workspace packages/common/commonTypes
	npm run lint --workspace packages/psuRestoreValidationLambda

lint-specification: compile-specification
	npm run lint --workspace packages/specification

lint-samtemplates:
	poetry run cfn-lint -I "SAMtemplates/**/*.yaml" 2>&1 | grep "Run scan"

lint-python:
	poetry run flake8 scripts/*.py --config .flake8

lint-githubactions:
	actionlint

lint-githubaction-scripts:
	shellcheck .github/scripts/*.sh

lint: lint-node lint-samtemplates lint-python lint-githubactions lint-githubaction-scripts lint-specification

test: compile
	npm run test --workspace packages/updatePrescriptionStatus
	npm run test --workspace packages/gsul
	npm run test --workspace packages/nhsd-psu-sandbox
	npm run test --workspace packages/statusLambda
	npm run test --workspace packages/capabilityStatement
	npm run test --workspace packages/cpsuLambda
	npm run test --workspace packages/checkPrescriptionStatusUpdates
	npm run test --workspace packages/nhsNotifyLambda
	npm run test --workspace packages/nhsNotifyUpdateCallback
	npm run test --workspace packages/common/middyErrorHandler
	npm run test --workspace packages/psuRestoreValidationLambda
	npm run test --workspace packages/common/utilities

clean:
	rm -rf packages/updatePrescriptionStatus/coverage
	rm -rf packages/updatePrescriptionStatus/lib
	rm -rf packages/nhsd-psu-sandbox/coverage
	rm -rf packages/nhsd-psu-sandbox/lib
	rm -rf packages/specification/coverage
	rm -rf packages/specification/lib
	rm -rf packages/statusLambda/coverage
	rm -rf packages/statusLambda/lib
	rm -rf packages/capabilityStatement/coverage
	rm -rf packages/capabilityStatement/lib
	rm -rf packages/cpsuLambda/coverage
	rm -rf packages/cpsuLambda/lib
	rm -rf packages/nhsNotifyLambda/coverage
	rm -rf packages/nhsNotifyLambda/lib
	rm -rf packages/nhsNotifyUpdateCallback/coverage
	rm -rf packages/nhsNotifyUpdateCallback/lib
	rm -rf packages/checkPrescriptionStatusUpdates/lib
	rm -rf packages/common/testing/lib
	rm -rf packages/common/middyErrorHandler/lib
	rm -rf packages/common/commonTypes/lib
	rm -rf .aws-sam

deep-clean: clean
	rm -rf venv
	find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +
	poetry env remove --all

check-licenses: check-licenses-node check-licenses-python

check-licenses-node:
	npm run check-licenses

check-licenses-python:
	scripts/check_python_licenses.sh

aws-configure:
	aws configure sso --region eu-west-2

aws-login:
	aws sso login --sso-session sso-session

cfn-guard:
	./scripts/run_cfn_guard.sh
