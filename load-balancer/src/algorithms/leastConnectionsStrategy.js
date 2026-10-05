// load-balancer/src/algorithms/leastConnectionsStrategy.js
// Smarter than round robin: tracks how many requests are CURRENTLY in-flight
// to each node, and always routes the next request to whichever healthy node
// has the FEWEST active connections right now. This matters when requests
// take meaningfully different amounts of time — round robin would keep
// sending new requests to an already-overloaded node just because "it's its
// turn," while least-connections naturally avoids that.
// → [Load Balancing]

function createLeastConnectionsStrategy() {
  const activeConnectionCounts = new Map(); // port -> current in-flight request count

  function pickNextNode(healthyPorts) {
    if (healthyPorts.length === 0) {
      return null;
    }

    // Find the healthy node with the minimum current connection count.
    // Ports not yet in the map (brand new) are treated as having 0 connections.
    let selectedPort = healthyPorts[0];
    let lowestCount = activeConnectionCounts.get(selectedPort) || 0;

    for (const port of healthyPorts) {
      const count = activeConnectionCounts.get(port) || 0;
      if (count < lowestCount) {
        selectedPort = port;
        lowestCount = count;
      }
    }

    return selectedPort;
  }

  // MUST be called the instant a request starts being proxied to a node.
  function incrementConnectionCount(port) {
    activeConnectionCounts.set(port, (activeConnectionCounts.get(port) || 0) + 1);
  }

  // MUST be called the instant that proxied request finishes (success or error) —
  // forgetting this call anywhere would permanently overcount that node's load,
  // so server.js needs to guarantee this runs in a `finally`-equivalent spot.
  function decrementConnectionCount(port) {
    const current = activeConnectionCounts.get(port) || 0;
    activeConnectionCounts.set(port, Math.max(0, current - 1));
  }

  return { pickNextNode, incrementConnectionCount, decrementConnectionCount };
}

module.exports = { createLeastConnectionsStrategy };