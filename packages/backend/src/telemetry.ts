import { hrtime } from "node:process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { metrics, type Attributes } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type RequestWithTelemetryStart = FastifyRequest & {
  telemetryStart?: bigint;
};

export interface TelemetryHandle {
  enabled: boolean;
  registerFastifyMetrics(app: FastifyInstance): void;
  shutdown(): Promise<void>;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isMetricsEnabled(): boolean {
  if (process.env.OTEL_SDK_DISABLED === "true") return false;
  const exporter = process.env.OTEL_METRICS_EXPORTER;
  return Boolean(exporter) && exporter !== "none";
}

function requestAttributes(request: FastifyRequest, reply?: FastifyReply): Attributes {
  return {
    method: request.method,
    route: request.routeOptions?.url ?? request.url,
    status_code: reply?.statusCode ?? 0,
  };
}

export function startTelemetry(): TelemetryHandle {
  if (!isMetricsEnabled()) {
    return {
      enabled: false,
      registerFastifyMetrics: () => undefined,
      shutdown: async () => undefined,
    };
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || "aurex-backend";
  const exportIntervalMillis = envInt("OTEL_METRIC_EXPORT_INTERVAL", 15_000);
  const exportTimeoutMillis = envInt("OTEL_METRIC_EXPORT_TIMEOUT", 10_000);
  const reader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis,
    exportTimeoutMillis,
  });
  const meterProvider = new MeterProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.namespace": "aurex",
      "service.version": process.env.npm_package_version ?? "0.1.0",
    }),
    readers: [reader],
  });

  metrics.setGlobalMeterProvider(meterProvider);

  const meter = metrics.getMeter("aurex-backend");
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();

  const requestsTotal = meter.createCounter("http.server.requests.total", {
    description: "Total backend HTTP requests handled by Aurex.",
    unit: "1",
  });
  const requestDurationMs = meter.createHistogram("http.server.request.duration", {
    description: "Backend HTTP request duration.",
    unit: "ms",
  });
  const activeRequests = meter.createUpDownCounter("http.server.active_requests", {
    description: "Currently active backend HTTP requests.",
    unit: "1",
  });

  const memoryUsage = meter.createObservableGauge("nodejs.memory.usage", {
    description: "Node.js process memory usage by memory state.",
    unit: "By",
  });
  memoryUsage.addCallback((observable) => {
    const usage = process.memoryUsage();
    observable.observe(usage.rss, { state: "rss" });
    observable.observe(usage.heapTotal, { state: "heap_total" });
    observable.observe(usage.heapUsed, { state: "heap_used" });
    observable.observe(usage.external, { state: "external" });
    observable.observe(usage.arrayBuffers, { state: "array_buffers" });
  });

  const uptime = meter.createObservableGauge("nodejs.uptime", {
    description: "Node.js process uptime.",
    unit: "s",
  });
  uptime.addCallback((observable) => {
    observable.observe(process.uptime());
  });

  const eventLoopDelayMs = meter.createObservableGauge("nodejs.event_loop.delay", {
    description: "Mean Node.js event loop delay since the previous collection.",
    unit: "ms",
  });
  eventLoopDelayMs.addCallback((observable) => {
    observable.observe(eventLoopDelay.mean / 1_000_000);
    eventLoopDelay.reset();
  });

  return {
    enabled: true,
    registerFastifyMetrics(app: FastifyInstance) {
      app.addHook("onRequest", async (request) => {
        (request as RequestWithTelemetryStart).telemetryStart = hrtime.bigint();
        activeRequests.add(1, requestAttributes(request));
      });

      app.addHook("onResponse", async (request, reply) => {
        const telemetryRequest = request as RequestWithTelemetryStart;
        const startedAt = telemetryRequest.telemetryStart;
        const attributes = requestAttributes(request, reply);
        requestsTotal.add(1, attributes);
        if (startedAt) {
          const elapsedMs = Number(hrtime.bigint() - startedAt) / 1_000_000;
          requestDurationMs.record(elapsedMs, attributes);
        }
        activeRequests.add(-1, requestAttributes(request));
      });
    },
    async shutdown() {
      eventLoopDelay.disable();
      await meterProvider.shutdown();
      metrics.disable();
    },
  };
}
