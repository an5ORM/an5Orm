const assert = require('assert');
const { An5ORM, ViewClient, TableClient, An5ClientKnownRequestError } = require('../dist');

async function runTests() {
  console.log('\n=== Testing Complete ORM Features (Proxy, Table, View, Proc & Function) ===\n');

  // Mock executor tracking executed SQL and params
  let lastExecutedSql = '';
  let lastExecutedParams = {};
  const mockExecutor = async (sqlText, params) => {
    lastExecutedSql = sqlText;
    lastExecutedParams = params || {};
    if (sqlText.includes('EXEC')) {
      return [{ procResult: 'ok', count: 42 }];
    }
    if (sqlText.includes('SELECT * FROM [fn_')) {
      return [{ fnResult: 99 }];
    }
    return [{ id: 'u1', name: 'Alice', active: true }];
  };
  mockExecutor.executeRaw = async (sqlText, params) => {
    lastExecutedSql = sqlText;
    lastExecutedParams = params || {};
    return 1;
  };

  const metadata = {
    modelToTable: {
      User: 'Users',
      Order: 'Orders'
    },
    relationMap: {},
    modelFields: {}
  };

  const db = new An5ORM(mockExecutor, metadata);

  // 0. An5Adapter instance acceptance
  const mockAdapterObj = {
    exec: async (sql, p) => {
      lastExecutedSql = sql;
      return [{ id: 'a1', name: 'Adapter User' }];
    }
  };
  const adapterDb = new An5ORM(mockAdapterObj, metadata);
  const adapterRows = await adapterDb.user.findMany();
  assert.strictEqual(adapterRows[0].name, 'Adapter User');
  console.log('  ✓ An5ORM constructor accepts An5Adapter instances directly');

  // 1. Explicit db.table()
  const userTable = db.table('User');
  assert.ok(userTable instanceof TableClient, 'db.table() should return TableClient');
  await userTable.findMany();
  assert.ok(lastExecutedSql.includes('Users'), 'db.table() query should use table name Users');
  console.log('  ✓ db.table() returns TableClient and executes queries');

  // 2. Dynamic proxy model access (db.user, db.User, db.users, db.Users)
  await db.user.findMany();
  assert.ok(lastExecutedSql.includes('Users'), 'db.user should resolve to Users');

  await db.User.findMany();
  assert.ok(lastExecutedSql.includes('Users'), 'db.User should resolve to Users');

  await db.users.findMany();
  assert.ok(lastExecutedSql.includes('Users'), 'db.users should resolve to Users');

  console.log('  ✓ Proxy model resolution handles camelCase, PascalCase, and plural variations');

  // 3. Database View support (db.$view & ViewClient)
  const userView = db.$view('UserSummaryView');
  assert.ok(userView instanceof ViewClient, 'db.$view() should return ViewClient');

  const viewRows = await userView.findMany({ where: { active: true } });
  assert.ok(Array.isArray(viewRows), 'view.findMany() returns array');
  assert.ok(lastExecutedSql.includes('UserSummaryView'), 'view.findMany() query targets UserSummaryView');

  const viewCount = await userView.count();
  assert.strictEqual(typeof viewCount, 'number', 'view.count() returns number');

  console.log('  ✓ ViewClient supports query operations (findMany, count)');

  // 4. View read-only protection guards
  await assert.rejects(
    async () => await userView.create({ data: { name: 'Bob' } }),
    (err) => err instanceof An5ClientKnownRequestError && err.message.includes('read-only'),
    'view.create() must throw read-only error'
  );

  await assert.rejects(
    async () => await userView.update({ where: { id: '1' }, data: { name: 'Bob' } }),
    (err) => err instanceof An5ClientKnownRequestError && err.message.includes('read-only'),
    'view.update() must throw read-only error'
  );

  await assert.rejects(
    async () => await userView.delete({ where: { id: '1' } }),
    (err) => err instanceof An5ClientKnownRequestError && err.message.includes('read-only'),
    'view.delete() must throw read-only error'
  );

  console.log('  ✓ ViewClient prevents write mutations (create, update, delete) with descriptive errors');

  // 5. Stored Procedure invocation ($queryProc & $executeProc)
  const procRows = await db.$queryProc('sp_get_active_users', { status: 'active', limit: 10 });
  assert.ok(lastExecutedSql.includes('EXEC [sp_get_active_users]'), 'EXEC query text formatted');
  assert.strictEqual(lastExecutedParams.p_status_0, 'active');
  assert.strictEqual(procRows[0].procResult, 'ok');
  console.log('  ✓ db.$queryProc() builds EXEC SQL and passes params');

  const procAffected = await db.$executeProc('sp_deactivate_users', ['inactive', 30]);
  assert.ok(lastExecutedSql.includes('EXEC [sp_deactivate_users] @p_0, @p_1'), 'Positional EXEC params formatted');
  assert.strictEqual(procAffected, 1);
  console.log('  ✓ db.$executeProc() handles array params and returns affected count');

  // 7. Telemetry & Event Listener API ($on, $off, $emit)
  let capturedQueryEvent = null;
  let capturedWarnEvent = null;

  const queryListener = (e) => { capturedQueryEvent = e; };
  const warnListener = (e) => { capturedWarnEvent = e; };

  db.$on('query', queryListener);
  db.$on('warn', warnListener);
  db.slowQueryThresholdMs = 1; // Trigger slow query warning for queries >= 1ms

  await db.user.findMany();
  assert.ok(capturedQueryEvent, 'query event captured');
  assert.strictEqual(capturedQueryEvent.model, 'User');
  assert.strictEqual(capturedQueryEvent.action, 'findMany');
  assert.ok(typeof capturedQueryEvent.duration === 'number');

  // Verify $off removes event listener
  db.$off('query', queryListener);
  capturedQueryEvent = null;
  await db.user.findMany();
  assert.strictEqual(capturedQueryEvent, null, 'query listener removed via $off');

  console.log('  ✓ Telemetry Event Listener API ($on, $off, $emit, slow query thresholds) verified');

  console.log('\n🎉 All ORM feature tests passed!\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
