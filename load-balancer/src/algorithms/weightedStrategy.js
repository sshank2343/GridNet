// load-balancer/src/algorithms/weightedStrategy.js
// Weighted round robin: each node is assigned a WEIGHT representing its
// relative capacity (e.g. a node on a bigger machine might get weight 3,
// a smaller one weight 1 — meaning the bigger one receives 3x the traffic).
// Uses a smooth weighted round robin algorithm (the same approach Nginx's
// real weighted load balancing uses internally) rather than naive "repeat
// each node N times in a list," which would send bursty, uneven traffic
// (weight-3 node getting 3 requests in a row, then nothing for a while).
// → [Load Balancing]

function createWeightedStrategy(nodeWeights) {
  // nodeWeights example: { 6001: 3, 6002: 1, 6003: 1 } — node on 6001 gets
  // 3x the traffic of the other two.

  const currentWeights = new Map(
    Object.entries(nodeWeights).map(([port, weight]) => [Number(port), 0])
  );

  function pickNextNode(healthyPorts) {
    if (healthyPorts.length === 0) {
      return null;
    }

    // Smooth weighted round robin algorithm:
    // 1. Add each node's static weight to its running "current weight" total.
    // 2. Pick whichever healthy node now has the HIGHEST current weight.
    // 3. Subtract the TOTAL weight of all healthy nodes from the winner's
    //    current weight (so it "cools down" proportionally and won't win
    //    again immediately unless its weight is high enough to deserve it).
    let totalWeight = 0;
    let selectedPort = null;
    let highestCurrentWeight = -Infinity;

    healthyPorts.forEach((port) => {
      const staticWeight = nodeWeights[port] || 1;
      totalWeight += staticWeight;

      const updatedCurrentWeight = (currentWeights.get(port) || 0) + staticWeight;
      currentWeights.set(port, updatedCurrentWeight);

      if (updatedCurrentWeight > highestCurrentWeight) {
        highestCurrentWeight = updatedCurrentWeight;
        selectedPort = port;
      }
    });

    currentWeights.set(selectedPort, highestCurrentWeight - totalWeight);

    return selectedPort;
  }

  return { pickNextNode };
}

module.exports = { createWeightedStrategy };