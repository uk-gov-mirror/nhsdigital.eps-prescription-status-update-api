# EPS Prescription Status Update API

![Build](https://github.com/NHSDigital/eps-prescription-status-update-api/actions/workflows/ci.yml/badge.svg?branch=main)  
![Release](https://github.com/NHSDigital/eps-prescription-status-update-api/actions/workflows/release.yml/badge.svg?branch=main)

## Versions and deployments

Version release history can be found ot https://github.com/NHSDigital/eps-prescription-status-update-api/releases.  
We use eslint convention for commit messages for commits to main branch. Descriptions for the types of changes in a release can be found in the [contributing guidelines](./CONTRIBUTING.md)  
Deployment history can be found at https://nhsdigital.github.io/eps-prescription-status-update-api/

## Introduction

This is the AWS layer that provides an API for EPS Prescription Status Update.

- `packages/updatePrescriptionStatus` Handles updating prescription status for the root endpoint.
- `packages/nhsd-psu-sandbox` A sandbox endpoint returning an example response.
- `packages/specification` This [Open API Specification](https://swagger.io/docs/specification/about/) describes the endpoints, methods and messages.
- `packages/statusLambda` Returns the status of the updatePrescriptionStatus endpoint.
- `packages/capabilityStatement` Returns a static capability statement.
- `packages/cpsuLambda` Handles updating prescription status using a custom format.
- `packages/nhsNotifyLambda` Handles sending prescription notifications to the NHS notify service.
- `packages/nhsNotifyUpdateCallback` Handles receiving notification updates from the NHS notify service.
- `packages/checkPrescriptionStatusUpdates` Validates and retrieves prescription status update data.
- `packages/gsul` Expose data owned by PSU but needed by [PfP](https://github.com/NHSDigital/prescriptionsforpatients)
- `packages/psuRestoreValidationLambda` Lambda function that validates prescription status update restore operations.
- `packages/common/commonTypes` Common TypeScript type definitions and interfaces.
- `packages/common/middyErrorHandler` Middleware for handling errors in Lambda functions using Middy.
- `packages/common/testing` Shared testing utilities and resources.
- `scripts/` Utilities helpful to developers of this specification.
- `postman/` Postman collections to call the APIs. Documentation on how to use them are in the collections.
- `SAMtemplates/` Contains the SAM templates used to define the stacks.
- `.devcontainer` Contains a dockerfile and vscode devcontainer definition.
- `.github` Contains github workflows that are used for building and deploying from pull requests and releases.
- `.vscode` Contains vscode workspace file.
- `.releaserc` semantic-release config file

Consumers of the API will find developer documentation on the [NHS Digital Developer Hub](https://digital.nhs.uk/developer/api-catalogue).

## Database Backups (LOOK HERE IF YOU ARE PANICKING)

Stacks deployed to AWS use a DynamoDB database for data persistence, and this is configured to use Point In Time Recovery ([PITR](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)). This allows the database to be rolled back to a previous state, in cases where the present state of the database is unwholesome. Backups are (at the time of writing) persisted for 35 days, or 5 calendar weeks. For instructions on how to roll back the database table, please refer to the [AWS documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/pointintimerecovery_restores.html). The console version of the instructions is likely to be the one used.

Note that backups are "restored" as new tables, and cannot overwrite the existing one - the SAM template will need to be updated to use the new table. In addition, the newly created table will not have PITR enabled by default. Any recovery strategy requiring the backups must be cognizant of these quirks.

## Contributing

Contributions to this project are welcome from anyone, providing that they conform to the [guidelines for contribution](https://github.com/NHSDigital//eps-prescription-status-update-api/blob/main/CONTRIBUTING.md) and the [community code of conduct](https://github.com/NHSDigital//eps-prescription-status-update-api/blob/main/CODE_OF_CONDUCT.md).

### Licensing

This code is dual licensed under the MIT license and the OGL (Open Government License). Any new work added to this repository must conform to the conditions of these licenses. In particular this means that this project may not depend on GPL-licensed or AGPL-licensed libraries, as these would violate the terms of those libraries' licenses.

The contents of this repository are protected by Crown Copyright (C).

## Development

It is recommended that you use visual studio code and a devcontainer as this will install all necessary components and correct versions of tools and languages.  
See https://code.visualstudio.com/docs/devcontainers/containers for details on how to set this up on your host machine.  
There is also a workspace file in .vscode that should be opened once you have started the devcontainer. The workspace file can also be opened outside of a devcontainer if you wish.  
The project uses [SAM](https://aws.amazon.com/serverless/sam/) to develop and deploy the APIs and associated resources.

All commits must be made using [signed commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

Once the steps at the link above have been completed. Add to your ~/.gnupg/gpg.conf as below:

```
use-agent
pinentry-mode loopback
```

and to your ~/.gnupg/gpg-agent.conf as below:

```
allow-loopback-pinentry
```

As described here:
https://stackoverflow.com/a/59170001

You will need to create the files, if they do not already exist.
This will ensure that your VSCode bash terminal prompts you for your GPG key password.

You can cache the gpg key passphrase by following instructions at https://superuser.com/questions/624343/keep-gnupg-credentials-cached-for-entire-user-session

### CI Setup

The GitHub Actions require a secret to exist on the repo called "SONAR_TOKEN".
This can be obtained from [SonarCloud](https://sonarcloud.io/)
as described [here](https://docs.sonarsource.com/sonarqube/latest/user-guide/user-account/generating-and-using-tokens/).
You will need the "Execute Analysis" permission for the project (NHSDigital_eps-prescription-status-update-api) in order for the token to work.

### Continuous deployment for testing

You can run the following command to deploy the code to AWS for testing

```
make sam-sync
```

This will take a few minutes to deploy - you will see something like this when deployment finishes

```
......
CloudFormation events from stack operations (refresh every 0.5 seconds)
---------------------------------------------------------------------------------------------------------------------------------------------------------------------
ResourceStatus                            ResourceType                              LogicalResourceId                         ResourceStatusReason
---------------------------------------------------------------------------------------------------------------------------------------------------------------------
.....
CREATE_IN_PROGRESS                        AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  -
CREATE_IN_PROGRESS                        AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  Resource creation Initiated
CREATE_COMPLETE                           AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  -
CREATE_COMPLETE                           AWS::CloudFormation::Stack                ab-1                                      -
---------------------------------------------------------------------------------------------------------------------------------------------------------------------


Stack creation succeeded. Sync infra completed.
```

Note - the command will keep running and should not be stopped.
You can now call this api.

```
curl -X POST https://${stack_name}.dev.eps.national.nhs.uk/
```

You can also use the AWS vscode extension to invoke the API or lambda directly

Any code changes you make are automatically uploaded to AWS while `make sam-sync` is running allowing you to quickly test any changes you make

### Pre-commit hooks

Some pre-commit hooks are installed as part of the install above, to run basic lint checks and ensure you can't accidentally commit invalid changes.
The pre-commit hook uses python package pre-commit and is configured in the file .pre-commit-config.yaml.
A combination of these checks are also run in CI.

### Make commands

There are `make` commands that are run as part of the CI pipeline and help alias some functionality during development.

#### Install targets

- `install-node` Installs node dependencies
- `install-python` Installs python dependencies
- `install-hooks` Installs git pre commit hooks
- `install` Runs all install targets

#### SAM targets

These are used to do common commands

- `sam-build` Prepares the lambdas and SAM definition file to be used in subsequent steps.
- `sam-run-local` Runs the API and lambdas locally.
- `sam-sync` Sync the API and lambda to AWS. This keeps running and automatically uploads any changes to lambda code made locally. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-deploy` Deploys the compiled SAM template from sam-build to AWS. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-delete` Deletes the deployed SAM cloud formation stack and associated resources. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-list-endpoints` Lists endpoints created for the current stack. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-list-resources` Lists resources created for the current stack. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-list-outputs` Lists outputs from the current stack. Needs AWS_DEFAULT_PROFILE and stack_name environment variables set.
- `sam-validate` Validates the main SAM template and the splunk firehose template.
- `sam-deploy-package` Deploys a package created by sam-build. Used in CI builds. Needs the following environment variables set.
  - artifact_bucket - bucket where uploaded packaged files are
  - artifact_bucket_prefix - prefix in bucket of where uploaded packaged files ore
  - stack_name - name of stack to deploy
  - template_file - name of template file created by sam-package
  - cloud_formation_execution_role - ARN of role that cloud formation assumes when applying the changeset

#### Clean and deep-clean targets

- `clean` Clears up any files that have been generated by building or testing locally.
- `deep-clean` Runs clean target and also removes any node_modules and python libraries installed locally.

#### Linting and testing

- `lint` Runs lint for all code
- `lint-node` Runs lint for node code
- `lint-githubactions` Runs lint for github actions workflows
- `lint-githubaction-scripts` Runs shellcheck for github actions scripts
- `lint-python` Runs lint for python code
- `lint-samtemplates` Runs lint for SAM templates
- `test` Runs unit tests for all code
- `cfn-guard` runs cfn-guard for sam and cloudformation templates

#### Publish targets

- `publish` Outputs the specification as a **single file** into the `dist/` directory. This is used when uploading to Apigee, which requires the spec as a single file.

#### Compiling

- `compile` Compiles all code
- `compile-node` Runs tsc to compile typescript code

#### Check licenses

- `check-licenses` Checks licenses for all packages used - calls check-licenses-node, check-licenses-python
- `check-licenses-node` Checks licenses for all node code
- `check-licenses-python` Checks licenses for all python code

#### CLI Login to AWS

- `aws-configure` Configures a connection to AWS
- `aws-login` Reconnects to AWS from a previously configured connection

### Github folder

This .github folder contains workflows and templates related to GitHub, along with actions and scripts pertaining to Jira.

- `pull_request_template.yml` Template for pull requests.
- `dependabot.yml` Dependabot definition file.

Actions are in the `.github/actions` folder:

- `mark_jira_released` Action to mark Jira issues as released.
- `update_confluence_jira` Action to update Confluence with Jira issues.

Scripts are in the `.github/scripts` folder:

- `call_mark_jira_released.sh` Calls a Lambda function to mark Jira issues as released.
- `create_env_release_notes.sh` Generates release notes for a specific environment using a Lambda function.
- `create_int_rc_release_notes.sh` Creates release notes for integration environment using a Lambda function.
- `delete_stacks.sh` Checks and deletes active CloudFormation stacks associated with closed pull requests.
- `get_current_dev_tag.sh` Retrieves the current development tag and sets it as an environment variable.
- `get_target_deployed_tag.sh` Retrieves the currently deployed tag and sets it as an environment variable.
- `release_code.sh` Releases code by deploying it using AWS SAM after packaging it.

Workflows are in the `.github/workflows` folder:

- `ci.yml` Workflow run when code merged to main. Deploys to dev and qa environments.
- `combine-dependabot-prs.yml` Workflow for combining dependabot pull requests. Runs on demand.
- `delete_old_cloudformation_stacks.yml` Workflow for deleting old cloud formation stacks. Runs daily.
- `dependabot_auto_approve_and_merge.yml` Workflow to auto merge dependabot updates.
- `pr_title_check.yaml` Checks title of pull request is valid.
- `pr-link.yaml` This workflow template links Pull Requests to Jira tickets and runs when a pull request is opened.
- `pull_request.yml` Called when pull request is opened or updated. Calls run_package_code_and_api and run_release_code_and_api to build and deploy the code. Deploys to dev AWS account and internal-dev and internal-dev sandbox apigee environments. The main stack deployed adopts the naming convention psu-pr-<PULL_REQUEST_ID>, while the sandbox stack follows the pattern psu-sandbox-pr-<PULL_REQUEST_ID>
- `release.yml` Runs on demand to create a release and deploy to all environments.
- `run_package_code_and_api.yml` Packages code and api and uploads to a github artifact for later deployment.
- `run_release_code_and_api.yml` Release code and api built by run_package_code_and_api.yml to an environment.

### Github pages

Github pages is used to display deployment information. The source for github pages is in the gh-pages branch.  
As part of the ci and release workflows, the release tag (either the short commit SHA or release tag) is appended to \_data/{environment}\_deployments.csv so we have a history of releases and replaced in \_data/{environment}\_latest.csv so we now what the latest released version is.  
There are different makefile targets in this branch. These are

- `run-jekyll` - runs the site locally so changes can be previewed during development
- `sync-main` - syncs common files from main branch to gh-pages branch. You must commit and push after running this
- `install-python` installs python dependencies
- `install-hooks` installs git pre commit hooks
- `install-node` installs node dependencies
- `install-jekyll` installs dependencies to be able to run jekyll locally
- `install` runs all install targets
