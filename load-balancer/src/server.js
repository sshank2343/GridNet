// load-balancer/src/server.js
// This IS a reverse proxy — contrast with a FORWARD proxy (which sits in
// front of CLIENTS, hiding their identity from servers they talk to, e.g. a
// corporate VPN proxy). A REVERSE proxy sits in front of SERVERS, hiding
// their identity/topology from clients — the client only ever knows about
// THIS load balancer's address; it has no idea 3 separate worker-node
// processes even exist behind it. Same proxying mechanism as OrderCore's
// gateway (Project 1), but here YOU wrote the routing decision logic
// yourself instead of just forwarding to a fixed address per path.
// → [Proxy vs Reverse Proxy]

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createServiceLogger } = require('shared/logger');
const { createNodeHealthTracker } = require('./health/nodeHealthTracker');
const { createRoundRobinStrategy } = require('./algorithms/roundRobinStrategy');
const { createLeastConnectionsStrategy } = require('./algorithms/leastConnectionsStrategy');
const { createWeightedStrategy } = require('./algorithms/weightedStrategy');

const logger = createServiceLogger('load-balancer');
const app = express();

const CLUSTER_PORTS = (process.env.CLUSTER_NODE_PORTS || '6001,6002,6003').split(',').map(Number);

// Swap this to change algorithm — e.g. try 'LEAST_CONNECTIONS' or 'WEIGHTED'
// and re-run the load test to SEE the routing pattern change.
const ACTIVE_STRATEGY = process.env.LB_STRATEGY || 'ROUND_ROBIN';

const healthTracker = createNodeHealthTracker({
  clusterPorts: CLUSTER_PORTS,
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS) || 3000,
  heartbeatTimeoutMs: Number(process.env.HEARTBEAT_TIMEOUT_MS) || 9000,
  logger,
});

const roundRobinStrategy = createRoundRobinStrategy();
const leastConnectionsStrategy = createLeastConnectionsStrategy();
const weightedStrategy = createWeightedStrategy({ 6001: 3, 6002: 1, 6003: 1 });

function pickNodeUsingActiveStrategy(healthyPorts) {
  if (ACTIVE_STRATEGY === 'LEAST_CONNECTIONS') {
    return leastConnectionsStrategy.pickNextNode(healthyPorts);
  }
  if (ACTIVE_STRATEGY === 'WEIGHTED') {
    return weightedStrategy.pickNextNode(healthyPorts);
  }
  return roundRobinStrategy.pickNextNode(healthyPorts);
}

// The actual reverse-proxy middleware. Notice `router` is a FUNCTION here,
// not a fixed string — http-proxy-middleware calls this function on EVERY
// incoming request, letting us make a FRESH routing decision (via our chosen
// algorithm) each time, rather than proxying to one hardcoded target.
app.use(
  '/',
  createProxyMiddleware({
    router: (req) => {
      const healthyPorts = healthTracker.getHealthyNodePorts(); // → [Failover]: dead nodes never appear here
      const selectedPort = pickNodeUsingActiveStrategy(healthyPorts);

      if (!selectedPort) {
        return null; // triggers the proxy's error handler below (no healthy nodes)
      }

      req.selectedPortForThisRequest = selectedPort; // stash for connection tracking below
      return `http://localhost:${selectedPort}`;
    },
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        if (ACTIVE_STRATEGY === 'LEAST_CONNECTIONS') {
          leastConnectionsStrategy.incrementConnectionCount(req.selectedPortForThisRequest);
        }
        logger.info(`Routing ${req.method} ${req.originalUrl} -> port ${req.selectedPortForThisRequest} (${ACTIVE_STRATEGY})`);
      },
      proxyRes: (proxyRes, req) => {
        if (ACTIVE_STRATEGY === 'LEAST_CONNECTIONS') {
          leastConnectionsStrategy.decrementConnectionCount(req.selectedPortForThisRequest);
        }
      },
      error: (err, req, res) => {
        if (ACTIVE_STRATEGY === 'LEAST_CONNECTIONS' && req.selectedPortForThisRequest) {
          leastConnectionsStrategy.decrementConnectionCount(req.selectedPortForThisRequest);
        }
        logger.error(`Proxy error: ${err.message}`);
        res.status(503).json({ error: 'Service Unavailable', detail: 'No healthy backend nodes' });
      },
    },
  })
);

// Debug endpoint — watch this during the chaos test to see nodes flip DEAD/ALIVE live.
app.get('/admin/health-report', (req, res) => {
  res.status(200).json({ strategy: ACTIVE_STRATEGY, nodes: healthTracker.getFullHealthReport() });
});

const PORT = process.env.LOAD_BALANCER_PORT || 6000;

app.listen(PORT, () => {
  logger.info(`Load balancer listening on port ${PORT}, strategy: ${ACTIVE_STRATEGY}`);
  healthTracker.startHeartbeatChecks();
});