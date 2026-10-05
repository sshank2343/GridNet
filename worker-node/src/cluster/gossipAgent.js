// worker-node/src/cluster/gossipAgent.js
// A simplified SWIM-style gossip protocol. Each node maintains a local view
// of the cluster (memberList) and periodically picks a few RANDOM peers to
// exchange that view with. There is NO central registry anyone has to ask —
// information about a new node joining, or an existing node going quiet,
// spreads peer-to-peer, exponentially, across the whole cluster over a few
// gossip rounds. This is the real mechanism (simplified) behind how systems
// like Cassandra, Consul, and Akka Cluster handle membership without a
// single point of failure for "who's in the cluster right now."
// → [Gossip Protocol]
//
// Each member entry tracks:
//   status: 'ALIVE' | 'SUSPECT' | 'DEAD'
//   incarnationNumber: increases every time the member proves itself alive
//     again after being suspected — this is how SWIM resolves conflicting
//     information (a HIGHER incarnation number always wins/overrides a lower
//     one for the same node, so stale "this node is dead" rumors eventually
//     get corrected once the node proves it's actually alive).

const axios = require("axios");
const { createServiceLogger } = require("shared/logger");

function createGossipAgent({ selfNodeId, selfPort, seedPeerPorts, logger }) {
  const gossipLogger = logger || createServiceLogger(`gossip:${selfNodeId}`);

  const memberList = new Map();
  memberList.set(selfNodeId, {
    nodeId: selfNodeId,
    port: selfPort,
    status: "ALIVE",
    incarnationNumber: 0,
    lastUpdated: Date.now(),
  });

  seedPeerPorts.forEach((port) => {
    if (port === selfPort) return;
    memberList.set(`unknown-at-${port}`, {
      nodeId: `unknown-at-${port}`,
      port,
      status: "ALIVE",
      incarnationNumber: 0,
      lastUpdated: Date.now(),
    });
  });

  function pickRandomGossipTargets(count) {
    const candidates = Array.from(memberList.values()).filter(
      (m) => m.nodeId !== selfNodeId,
    );
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
  function mergeIncomingMemberList(incomingMembers) {
    incomingMembers.forEach((incomingMember) => {
      const existing = memberList.get(incomingMember.nodeId);
      const shouldAdopt =
        !existing ||
        incomingMember.incarnationNumber >= existing.incarnationNumber;

      if (shouldAdopt) {
        memberList.set(incomingMember.nodeId, incomingMember);
      }
    });
  }
  async function gossipWithOnePeer(peer) {
    try {
      const response = await axios.post(
        `http://localhost:${peer.port}/gossip/exchange`,
        { members: Array.from(memberList.values()) },
        { timeout: 2000 },
      );

      mergeIncomingMemberList(response.data.members);

      const placeholderKey = `unknown-at-${peer.port}`;
      if (
        memberList.has(placeholderKey) &&
        response.data.selfNodeId !== placeholderKey
      ) {
        memberList.delete(placeholderKey);
        memberList.set(response.data.selfNodeId, {
          nodeId: response.data.selfNodeId,
          port: peer.port,
          status: "ALIVE",
          incarnationNumber: 0,
          lastUpdated: Date.now(),
        });
      }
    } catch (error) {
      gossipLogger.warn(
        `Gossip exchange with port ${peer.port} failed: ${error.message}`,
      );
    }
  }
  function runOneGossipRound() {
    const targets = pickRandomGossipTargets(2); // gossip with 2 random peers per round
    targets.forEach((peer) => gossipWithOnePeer(peer));
  }

  function startGossiping(intervalMs) {
    setInterval(runOneGossipRound, intervalMs);
    gossipLogger.info(`Gossip agent started, interval ${intervalMs}ms`);
  }

  function getCurrentMemberList() {
    return Array.from(memberList.values());
  }

  function handleIncomingGossipExchange(incomingMembers) {
    mergeIncomingMemberList(incomingMembers);
    return { selfNodeId, members: Array.from(memberList.values()) };
  }

  return {
    startGossiping,
    getCurrentMemberList,
    handleIncomingGossipExchange,
    mergeIncomingMemberList, // exposed so nodeHealthTracker.js can update status on heartbeat failure
  };
}

module.exports = { createGossipAgent };
