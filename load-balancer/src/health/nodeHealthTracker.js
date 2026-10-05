// load-balancer/src/health/nodeHealthTracker.js
// Independently polls each worker node's /health endpoint on a fixed interval
// (heartbeat) and maintains the DEFINITIVE alive/dead status the load balancer
// actually trusts for routing decisions. This is deliberately SEPARATE from
// gossipAgent.js's membership view — gossip is for cluster-wide, eventually-
// consistent, peer-to-peer AWARENESS; this is for the load balancer's own,
// authoritative, directly-observed TRUTH about who it can safely send traffic to.
// → [Heartbeats] → [Failover] → [Fault Tolerance]
//
// Failover in action: the moment a node is marked DEAD here, the load
// balancer's routing algorithms (roundRobinStrategy.js etc.) simply stop
// seeing it in the "available nodes" list — traffic automatically reroutes
// to the remaining healthy nodes with zero manual intervention.

const axios = require('axios');
const { createServiceLogger } = require('shared/logger');

function createNodeHealthTracker({ clusterPorts, heartbeatIntervalMs, heartbeatTimeoutMs, logger }) {
  const healthLogger = logger || createServiceLogger('load-balancer:health');

  // port -> { isAlive, lastSuccessfulCheckAt, consecutiveFailures }
  const nodeHealthMap = new Map();

  clusterPorts.forEach((port) => {
    nodeHealthMap.set(port, { isAlive: true, lastSuccessfulCheckAt: Date.now(), consecutiveFailures: 0 });
  });

  async function checkSingleNodeHealth(port) {
    const currentStatus = nodeHealthMap.get(port);

    try {
      await axios.get(`http://localhost:${port}/health`, { timeout: 2000 });

      const wasAlive = currentStatus.isAlive;
      nodeHealthMap.set(port, { isAlive: true, lastSuccessfulCheckAt: Date.now(), consecutiveFailures: 0 });

      if (!wasAlive) {
        healthLogger.info(`Node on port ${port} RECOVERED — resuming traffic`);
      }
    } catch (err) {
      const newFailureCount = currentStatus.consecutiveFailures + 1;
      const timeSinceLastSuccess = Date.now() - currentStatus.lastSuccessfulCheckAt;

      // Only declare a node DEAD after it's been unreachable for longer than
      // heartbeatTimeoutMs — a single missed heartbeat could just be a brief
      // network blip, not a real failure. This threshold-based approach
      // avoids flapping a node's status on every tiny hiccup.
      const shouldMarkDead = timeSinceLastSuccess > heartbeatTimeoutMs;

      nodeHealthMap.set(port, {
        isAlive: !shouldMarkDead,
        lastSuccessfulCheckAt: currentStatus.lastSuccessfulCheckAt,
        consecutiveFailures: newFailureCount,
      });

      if (shouldMarkDead && currentStatus.isAlive) {
        healthLogger.warn(`Node on port ${port} marked DEAD after ${newFailureCount} failed heartbeats — FAILOVER triggered`);
      }
    }
  }

  function startHeartbeatChecks() {
    setInterval(() => {
      clusterPorts.forEach((port) => checkSingleNodeHealth(port));
    }, heartbeatIntervalMs);

    healthLogger.info(`Heartbeat checks started for ports: ${clusterPorts.join(', ')}`);
  }

  function getHealthyNodePorts() {
    return clusterPorts.filter((port) => nodeHealthMap.get(port).isAlive);
  }

  function getFullHealthReport() {
    return clusterPorts.map((port) => ({ port, ...nodeHealthMap.get(port) }));
  }

  return { startHeartbeatChecks, getHealthyNodePorts, getFullHealthReport };
}

module.exports = { createNodeHealthTracker };