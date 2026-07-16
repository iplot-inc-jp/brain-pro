import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTools } from './rag.mjs';

function setup() {
  const tools = new Map();
  const calls = [];
  const server = {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
  };
  const call = async (...args) => {
    calls.push(args);
    return { ok: true };
  };
  registerTools(server, call);
  return { tools, calls };
}

test('RAG検索をプロジェクト・検索条件つきで呼び出す', async () => {
  const { tools, calls } = setup();
  const result = await tools.get('rag_search').handler({
    projectId: 'p1',
    q: '受注',
    featureType: 'BUSINESS_FLOW',
    scopeLevel: 'COMPONENT',
    limit: 8,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0], [
    'GET',
    '/projects/p1/rag/search',
    { query: { q: '受注', featureType: 'BUSINESS_FLOW', scopeLevel: 'COMPONENT', limit: 8 } },
  ]);
});

test('RAG生成と状態確認をtargetIdつきで呼び出す', async () => {
  const { tools, calls } = setup();
  await tools.get('rag_generate').handler({
    projectId: 'p1', featureType: 'ISSUE_TREE', targetId: 'tree1',
  });
  await tools.get('rag_status').handler({
    projectId: 'p1', featureType: 'ISSUE_TREE', targetId: 'tree1',
  });

  assert.deepEqual(calls, [
    ['POST', '/projects/p1/rag/generate', {
      body: { featureType: 'ISSUE_TREE', targetId: 'tree1' },
    }],
    ['GET', '/projects/p1/rag/status', {
      query: { featureType: 'ISSUE_TREE', targetId: 'tree1' },
    }],
  ]);
});
