/*
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the Apache License Version 2.0.
 *
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2021 Datadog, Inc.
 */

import Service from "serverless/classes/Service";
import { Provider } from "serverless/plugins/aws/provider/awsProvider";
import { FunctionInfo } from "./layer";

const ddTraceEnabledEnvVar = "DD_TRACE_ENABLED";
const ddMergeXrayTracesEnvVar = "DD_MERGE_XRAY_TRACES";

export enum TracingMode {
  XRAY,
  DD_TRACE,
  HYBRID,
  NONE,
}

export function enableTracing(service: Service, tracingMode: TracingMode, handlers: FunctionInfo[]) {
  const provider = service.provider as Provider;
  if (tracingMode === TracingMode.XRAY || tracingMode === TracingMode.HYBRID) {
    provider.tracing = {
      apiGateway: provider.apiGateway?.restApiId
        ? (undefined as any) // Current type definition does not allow undefined however it is a valid option.
        : true,
      lambda: true,
    };
  }
  handlers.forEach(({ handler }) => {
    handler.environment ??= {};
    const environment = handler.environment as any;
    // if tracing is not enabled, merge x-ray cannot be enabled
    if (environment[ddTraceEnabledEnvVar] === false || environment[ddTraceEnabledEnvVar] === "false") {
      environment[ddMergeXrayTracesEnvVar] = false;
    }
  });
}
