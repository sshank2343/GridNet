// load-balancer/src/hashing/consistentHashRing.js
// Implements consistent hashing using a hash RING with virtual nodes.
//
// THE PROBLEM with naive hash(key) % numberOfNodes:
//   If you have 3 nodes and use key % 3, then go to 4 nodes (key % 4),
//   almost EVERY key now maps to a different node than before — because the
//   divisor itself changed. For a cache, this means nearly a full cache
//   wipe/reshuffle just from adding ONE node.
//
// THE FIX — a hash ring:
//   Imagine a circle representing all possible hash values (0 to 2^32-1).
//   Each NODE is placed at one or more points on this circle (by hashing its
//   ID). Each KEY is also hashed onto this same circle. A key belongs to
//   whichever node's point is the NEXT one clockwise from the key's point.
//   When a node is added, it only "steals" the keys that fall between it and
//   the PREVIOUS node on the ring — everything else on the ring is COMPLETELY
//   UNAFFECTED. This is the core guarantee: adding/removing one node only
//   reshuffles ~1/N of the keys, not all of them.
//
// VIRTUAL NODES: a single physical node is placed at MANY points around the
// ring (not just one), so load is spread evenly even with few physical nodes
// — without virtual nodes, you could get unlucky and have one physical node
// "own" a disproportionately large arc of the ring just by chance.
// → [Consistent Hashing]

const crypto = require('crypto');

function hashToRingPosition(input) {
  // Hash the input and take the first 8 hex characters (32 bits) as a number
  // — gives us a well-distributed position on a 0 to 2^32-1 ring.
  const hash = crypto.createHash('md5').update(input).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

function createConsistentHashRing({ virtualNodesPerPhysicalNode = 100 } = {}) {
  // Sorted array of { ringPosition, physicalNodeId } — kept sorted so we can
  // binary-search (or, here, simple linear scan since cluster sizes are
  // small) for "the next point clockwise" from any given key's position.
  let ringEntries = [];

  function addNodeToRing(physicalNodeId) {
    for (let i = 0; i < virtualNodesPerPhysicalNode; i++) {
      const virtualNodeKey = `${physicalNodeId}#vnode-${i}`;
      const ringPosition = hashToRingPosition(virtualNodeKey);
      ringEntries.push({ ringPosition, physicalNodeId });
    }
    ringEntries.sort((a, b) => a.ringPosition - b.ringPosition);
  }

  function removeNodeFromRing(physicalNodeId) {
    ringEntries = ringEntries.filter((entry) => entry.physicalNodeId !== physicalNodeId);
  }

  function getNodeResponsibleForKey(key) {
    if (ringEntries.length === 0) {
      return null;
    }

    const keyPosition = hashToRingPosition(key);

    // Find the first ring entry whose position is >= the key's position
    // ("walking clockwise" from the key until we hit a node).
    const nextEntry = ringEntries.find((entry) => entry.ringPosition >= keyPosition);

    // If no entry is >= keyPosition, we've wrapped around the ring back to
    // the very first entry (the ring is circular, position 0 comes "after"
    // the highest position).
    return nextEntry ? nextEntry.physicalNodeId : ringEntries[0].physicalNodeId;
  }

  function getRingSnapshot() {
    return ringEntries.map((e) => ({ ...e }));
  }

  return { addNodeToRing, removeNodeFromRing, getNodeResponsibleForKey, getRingSnapshot };
}

module.exports = { createConsistentHashRing, hashToRingPosition };