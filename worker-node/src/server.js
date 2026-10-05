// worker-node/src/server.js
// Boots one worker node. Run this 3 times (via npm run dev:worker1/2/3, each
// with a different NODE_ID and NODE_PORT) to get a real 3-node cluster that
// gossips, heartbeats, and elects a leader, all on your own machine.

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { createServiceLogger } = require('shared/logger');
const { createGossipAgent } = require('./cluster/gossipAgent');

const NODE_ID = process.env.NODE_ID || 'node-1';
const NODE_PORT = Number(process.env.NODE_PORT) || 6001;  
const ALL_CLUSTER_PORTS = (process.env.CLUSTER_NODE_PORTS || '6001,6002,6003')
  .split(',')
  .map(Number);


const logger = createServiceLogger(NODE_ID);
const app = express();
app.use(express.json());

const gossipAgent = createGossipAgent({
  selfNodeId: NODE_ID,
  selfPort: NODE_PORT,
  seedPeerPorts: ALL_CLUSTER_PORTS,
  logger,
});

// This is the endpoint gossipAgent.js's gossipWithOnePeer() calls on OTHER
// nodes. Every node both INITIATES gossip (outbound, in gossipAgent.js) AND
// RECEIVES it (inbound, right here) — gossip is symmetric, every node plays
// both roles simultaneously.  → [Gossip Protocol]
app.post('/gossip/exchange', (req, res) => {
  const result = gossipAgent.handleIncomingGossipExchange(req.body.members);
  res.status(200).json(result);
});

// Lets you (or the load balancer's health checker) see this node's current
// view of the whole cluster — useful for literally watching gossip converge.
app.get('/cluster/members', (req, res) => {
  res.status(200).json({ selfNodeId: NODE_ID, members: gossipAgent.getCurrentMemberList() });
});

// Heartbeat endpoint — polled by load-balancer's nodeHealthTracker.js to
// decide if this node is alive and should keep receiving traffic.
// → [Heartbeats]
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', nodeId: NODE_ID });
});

// Simple dummy "work" endpoint — what the load balancer actually routes
// real traffic to in the demo.
app.get('/work', (req, res) => {
  res.status(200).json({ message: `Handled by ${NODE_ID}`, timestamp: Date.now() });
});

app.listen(NODE_PORT, () => {
  logger.info(`${NODE_ID} listening on port ${NODE_PORT}`);
  gossipAgent.startGossiping(Number(process.env.GOSSIP_INTERVAL_MS) || 2000);
});