// load-balancer/src/algorithms/roundRobinStrategy.js
// Simplest load balancing algorithm: cycle through the list of currently
// healthy nodes in a fixed rotating order. Treats every node as equally
// capable — doesn't account for one node being slower or more loaded than
// another. Good default when all nodes are truly identical in capacity.
// → [Load Balancing]

function createRoundRobinStrategy() {
    let currentIndex=0;

    function pickNextNode(healthyPorts) {
        if(healthyPorts.length === 0){
            return null;
        }

        const selectedPort = healthyPorts[currentIndex % healthyPorts.length];
        currentIndex++;
        return selectedPort;
    }
    return { pickNextNode }
}

module.exports = { createRoundRobinStrategy }