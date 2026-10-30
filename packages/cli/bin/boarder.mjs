#!/usr/bin/env node
// boarder — 설치 · 세팅(boarder setup · status · restore)과 받은편지함 도구(log · ask · wait · close · say · cards · headers · mcp)
const [maj] = process.versions.node.split('.').map(Number);
if (maj < 20) { console.error(`Boarder needs Node 20 or newer (this is ${process.versions.node}). Install a newer Node, then run this again.`); process.exit(1); }
const { main } = await import('../src/main.mjs');
await main(process.argv.slice(2));
