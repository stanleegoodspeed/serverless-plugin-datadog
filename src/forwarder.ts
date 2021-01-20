import { debug } from "console";
import Service from "serverless/classes/Service";
import Aws = require("serverless/plugins/aws/provider/awsProvider");

const logGroupKey = "AWS::Logs::LogGroup";
const logGroupSubscriptionKey = "AWS::Logs::SubscriptionFilter";
const maxAllowableLogGroupSubscriptions: number = 2;

interface LogGroupResource {
  Type: typeof logGroupKey;
  Properties: {
    LogGroupName: string;
  };
}

interface DescribeSubscriptionFiltersResponse {
  subscriptionFilters: {
    creationTime: number;
    destinationArn: string;
    distribution: string;
    filterName: string;
    filterPattern: string;
    logGroupName: string;
    roleArn: string;
  }[];
}

function isLogGroup(value: any): value is LogGroupResource {
  return value.Type === logGroupKey;
}

export async function addCloudWatchForwarderSubscriptions(service: Service, aws: Aws, functionArn: string) {
  const resources = service.provider.compiledCloudFormationTemplate?.Resources;
  if (resources === undefined) {
    return ["No cloudformation stack available. Skipping subscribing Datadog forwarder."];
  }
  const errors = [];
  for (const [name, resource] of Object.entries(resources)) {
    if (!isLogGroup(resource) || !resource.Properties.LogGroupName.startsWith("/aws/lambda/")) {
      continue;
    }
    const logGroupName = resource.Properties.LogGroupName;
    const scopedSubName = `${name}Subscription`;

    let expectedSubName = `${service.getServiceName()}-${aws.getStage()}-${scopedSubName}-`;

    const stackName = aws.naming.getStackName();
    if (stackName) {
      expectedSubName = `${stackName}-${scopedSubName}-`;
    }

    const canSub = await canSubscribeLogGroup(aws, logGroupName, expectedSubName);
    if (!canSub) {
      errors.push(
        `Could not subscribe Datadog Forwarder due to too many existing subscription filter(s) for ${logGroupName}.`,
      );
      continue;
    }

    const subscription = {
      Type: logGroupSubscriptionKey,
      Properties: {
        DestinationArn: functionArn,
        FilterPattern: "",
        LogGroupName: { Ref: name },
      },
    };
    resources[scopedSubName] = subscription;
  }
  return errors;
}

export async function canSubscribeLogGroup(aws: Aws, logGroupName: string, expectedSubName: string) {
  const subscriptionFilters = await describeSubscriptionFilters(aws, logGroupName);
  const numberOfActiveSubscriptionFilters: number = subscriptionFilters.length;
  let foundDatadogSubscriptionFilter: boolean = false;
  for (const subscription of subscriptionFilters) {
    const filterName = subscription.filterName;
    if (filterName.startsWith(expectedSubName)) {
      foundDatadogSubscriptionFilter = true;
    }
  }
  if (!foundDatadogSubscriptionFilter && numberOfActiveSubscriptionFilters >= maxAllowableLogGroupSubscriptions) {
    return false;
  } else {
    return true;
  }
}

export async function describeSubscriptionFilters(aws: Aws, logGroupName: string) {
  try {
    const result: DescribeSubscriptionFiltersResponse = await aws.request(
      "CloudWatchLogs",
      "describeSubscriptionFilters",
      {
        logGroupName,
      },
    );
    return result.subscriptionFilters;
  } catch (err) {
    // An error will occur if the log group doesn't exist, so we swallow this and return an empty list.
    return [];
  }
}
