const assert = require('assert');
const { An5ORM } = require('../dist/index.js');

async function main() {
  const queries = [];
  const metadata = {
    modelToTable: {
      user: 'dbo.users] WITH (NOLOCK); DROP TABLE audit--',
      order: '[sales].[orders]',
    },
    modelFields: {
      user: { id: { ts: 'string', sql: 'NVARCHAR(1000)' }, name: { ts: 'string', sql: 'NVARCHAR(255)' } },
      order: { id: { ts: 'string', sql: 'NVARCHAR(1000)' }, userId: { ts: 'string', sql: 'NVARCHAR(1000)' } },
    },
    relationMap: {
      user: {
        orders: { modelName: 'order', relationType: 'many', foreignKey: 'userId', localKey: 'id' },
      },
      order: {},
    },
  };

  const db = new An5ORM(async (sql, params) => {
    queries.push({ sql, params });
    if (queries.length === 1) return [{ id: 'u1', name: 'Son' }];
    return [{ id: 'o1', userId: 'u1' }];
  }, metadata);

  const users = await db.user.findMany({
    where: { name: 'Son' },
    include: { orders: true },
  });

  assert.strictEqual(users.length, 1);
  assert.deepStrictEqual(users[0].orders, [{ id: 'o1', userId: 'u1' }]);
  assert.ok(
    queries[0].sql.includes('FROM [dbo].[users]] WITH (NOLOCK); DROP TABLE audit--] WITH (NOLOCK)'),
    `Expected escaped base table in SQL, got: ${queries[0].sql}`
  );
  assert.ok(
    queries[1].sql.includes('FROM [sales].[orders] WITH (NOLOCK)'),
    `Expected escaped relation table in SQL, got: ${queries[1].sql}`
  );
  assert.strictEqual(queries[0].params.name, 'Son');

  const selectQueries = [];
  const selectDb = new An5ORM(async (sql, params) => {
    selectQueries.push({ sql, params });
    if (selectQueries.length === 1) return [{ id: 'u1', name: 'Son' }];
    if (sql.includes('COUNT(*)')) return [{ parentId: 'u1', count: 2 }];
    return [
      { id: 'o1', userId: 'u1' },
      { id: 'o2', userId: 'u1' },
    ];
  }, metadata);

  const selectedUsers = await selectDb.user.findMany({
    select: {
      name: true,
      orders: { select: { id: true } },
      _count: true,
    },
  });

  assert.deepStrictEqual(selectedUsers, [{
    name: 'Son',
    orders: [{ id: 'o1' }, { id: 'o2' }],
    _count: { orders: 2 },
  }]);
  assert.ok(selectQueries[0].sql.includes('SELECT [name], [id] FROM'), `Expected parent relation key in select SQL, got: ${selectQueries[0].sql}`);
  assert.ok(selectQueries[1].sql.includes('SELECT [id], [userId] FROM [sales].[orders]'), `Expected child relation key in select SQL, got: ${selectQueries[1].sql}`);

  const nestedFilterQueries = [];
  const nestedFilterDb = new An5ORM(async (sql, params) => {
    nestedFilterQueries.push({ sql, params });
    if (nestedFilterQueries.length === 1) return [{ id: 'u1', name: 'Son' }];
    return [{ id: 'o2', userId: 'u1', status: 'paid' }];
  }, {
    modelToTable: {
      user: 'dbo.users',
      order: 'dbo.orders',
    },
    modelFields: {
      user: { id: { ts: 'string', sql: 'NVARCHAR(1000)' }, name: { ts: 'string', sql: 'NVARCHAR(255)' } },
      order: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        userId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        status: { ts: 'string', sql: 'NVARCHAR(50)' },
      },
    },
    relationMap: {
      user: {
        orders: { modelName: 'order', relationType: 'many', foreignKey: 'userId', localKey: 'id' },
      },
      order: {},
    },
  });

  const filteredIncludes = await nestedFilterDb.user.findMany({
    include: {
      orders: {
        where: { status: 'paid' },
        orderBy: { id: 'desc' },
      },
    },
  });

  assert.deepStrictEqual(filteredIncludes[0].orders, [{ id: 'o2', userId: 'u1', status: 'paid' }]);
  assert.ok(
    nestedFilterQueries[1].sql.includes('WHERE [userId] IN (@k_0) AND [status] = @rel_orders_status ORDER BY [id] DESC'),
    `Expected nested include where/orderBy SQL, got: ${nestedFilterQueries[1].sql}`
  );
  assert.strictEqual(nestedFilterQueries[1].params.rel_orders_status, 'paid');

  const writes = [];
  const writeExecutor = Object.assign(
    async (sql, params) => {
      writes.push({ kind: 'query', sql, params });
      return [];
    },
    {
      executeRaw: async (sql, params) => {
        writes.push({ kind: 'executeRaw', sql, params });
        return 7;
      },
    }
  );
  const writeDb = new An5ORM(writeExecutor, {
    modelToTable: { user: 'dbo.users' },
    modelFields: {
      user: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        name: { ts: 'string', sql: 'NVARCHAR(255)' },
        updatedAt: { ts: 'Date', sql: 'DATETIME2' },
      },
    },
    relationMap: { user: {} },
  });

  assert.deepStrictEqual(
    await writeDb.user.updateMany({ where: { name: 'Old' }, data: { name: 'New' } }),
    { count: 7 }
  );
  assert.deepStrictEqual(await writeDb.user.deleteMany({ where: { name: 'Old' } }), { count: 7 });
  assert.deepStrictEqual(await writeDb.user.createMany({ data: [{ id: 'u2', name: 'New' }] }), { count: 1 });
  assert.strictEqual(await writeDb.$executeRaw`UPDATE dbo.users SET name = ${'A'}`, 7);

  assert.strictEqual(writes.length, 4);
  assert.ok(writes.every((w) => w.kind === 'executeRaw'), 'Expected write paths to use executor.executeRaw');
  assert.ok(writes[0].sql.includes('UPDATE [dbo].[users] SET [name] = @name'));
  assert.ok(writes[1].sql.includes('DELETE FROM [dbo].[users] WHERE [name] = @name'));
  assert.ok(writes[2].sql.includes('INSERT INTO [dbo].[users]'));
  assert.ok(writes[3].sql.includes('UPDATE dbo.users SET name = @p_0'));

  const emptyUpdateDb = new An5ORM(Object.assign(async () => [], { executeRaw: async () => 99 }), {
    modelToTable: { user: 'dbo.users' },
    modelFields: { user: { id: { ts: 'string', sql: 'NVARCHAR(1000)' }, name: { ts: 'string', sql: 'NVARCHAR(255)' } } },
    relationMap: { user: {} },
  });
  assert.deepStrictEqual(await emptyUpdateDb.user.updateMany({ where: { name: 'Old' }, data: {} }), { count: 0 });

  const numericCalls = [];
  const numericExecutor = Object.assign(async (sql, params) => {
    numericCalls.push({ sql, params });
    if (/FROM \[dbo\]\.\[orders\]/.test(sql)) return [{ id: 'n1', userId: 'u1', total: 20 }];
    return [{ id: 'n1', userId: 'u1', total: params?.total_mul ?? params?.total_div ?? 20 }];
  }, {
    executeRaw: async (sql, params) => {
      numericCalls.push({ sql, params });
      return 11;
    },
  });
  const numericDb = new An5ORM(numericExecutor, {
    modelToTable: { order: 'dbo.orders' },
    modelFields: {
      order: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        userId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        total: { ts: 'number', sql: 'INT' },
      },
    },
    relationMap: { order: {} },
  });

  await numericDb.order.update({ where: { id: 'n1' }, data: { total: { multiply: 2 } } });
  await numericDb.order.update({ where: { id: 'n1' }, data: { total: { divide: 4 } } });
  assert.deepStrictEqual(await numericDb.order.updateMany({ where: { id: 'n1' }, data: { total: { multiply: 3 } } }), { count: 11 });
  assert.deepStrictEqual(await numericDb.order.updateMany({ where: { id: 'n1' }, data: { total: { divide: 5 } } }), { count: 11 });
  assert.ok(numericCalls.some((call) => call.sql.includes('SET [total] = [total] * @total_mul')));
  assert.ok(numericCalls.some((call) => call.sql.includes('SET [total] = [total] / @total_div')));
  assert.strictEqual(numericCalls.find((call) => call.sql.includes('@total_mul')).params.total_mul, 2);
  assert.strictEqual(numericCalls.find((call) => call.sql.includes('@total_div')).params.total_div, 4);
  assert.ok(numericCalls.some((call) => call.sql.includes('UPDATE [dbo].[orders] SET [total] = [total] * @total_mul WHERE [id] = @w_id') && call.params.total_mul === 3));
  assert.ok(numericCalls.some((call) => call.sql.includes('UPDATE [dbo].[orders] SET [total] = [total] / @total_div WHERE [id] = @w_id') && call.params.total_div === 5));

  const groupCalls = [];
  const groupDb = new An5ORM(async (sql, params) => {
    groupCalls.push({ sql, params });
    return [
      { userId: 'u1', count_all: 2, sum_total: 30 },
      { userId: 'u2', count_all: 1, sum_total: 10 },
    ];
  }, {
    modelToTable: { order: 'dbo.orders' },
    modelFields: {
      order: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        userId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        total: { ts: 'number', sql: 'INT' },
      },
    },
    relationMap: { order: {} },
  });

  const grouped = await groupDb.order.groupBy({
    by: 'userId',
    where: { total: { gte: 10 } },
    _count: true,
    _sum: { total: true },
    take: 2,
    skip: 1,
  });

  assert.deepStrictEqual(grouped[0], { userId: 'u1', _count: { _all: 2 }, _sum: { total: 30 } });
  assert.ok(groupCalls[0].sql.includes('GROUP BY [userId]'), `Expected group by field, got: ${groupCalls[0].sql}`);
  assert.ok(groupCalls[0].sql.includes('ORDER BY [userId] OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY'), `Expected pagination SQL, got: ${groupCalls[0].sql}`);
  assert.strictEqual(groupCalls[0].params.total_gte, 10);

  const aggregateCalls = [];
  const aggregateDb = new An5ORM(async (sql, params) => {
    aggregateCalls.push({ sql, params });
    return [{ count_all: 3, sum_total: 40, avg_total: 20, min_total: 10, max_total: 30 }];
  }, {
    modelToTable: { order: 'dbo.orders' },
    modelFields: {
      order: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        userId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        total: { ts: 'number', sql: 'INT' },
      },
    },
    relationMap: { order: {} },
  });

  const aggregateResult = await aggregateDb.order.aggregate({
    where: { total: { gte: 10 } },
    _count: true,
    _sum: { total: true, id: false },
    _avg: { total: true },
    _min: { total: true },
    _max: { total: true },
  });

  assert.deepStrictEqual(aggregateResult, {
    _count: { _all: 3 },
    _sum: { total: 40 },
    _avg: { total: 20 },
    _min: { total: 10 },
    _max: { total: 30 },
  });
  assert.ok(aggregateCalls[0].sql.includes('SUM([total]) as sum_total'), `Expected sum SQL, got: ${aggregateCalls[0].sql}`);
  assert.ok(!aggregateCalls[0].sql.includes('SUM([id])'), `False aggregate fields should be ignored, got: ${aggregateCalls[0].sql}`);
  assert.strictEqual(aggregateCalls[0].params.total_gte, 10);

  const upsertMergeCalls = [];
  const upsertMetadata = {
    modelToTable: { user: 'dbo.users' },
    modelFields: {
      user: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        email: { ts: 'string', sql: 'NVARCHAR(255)' },
        tenantId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        name: { ts: 'string', sql: 'NVARCHAR(255)' },
      },
    },
    relationMap: { user: {} },
  };
  const upsertDb = new An5ORM(async (sql, params) => {
    upsertMergeCalls.push({ sql, params });
    return [{ id: 'u3', email: 'son@example.com', tenantId: 't1', name: 'Merged' }];
  }, upsertMetadata);

  const merged = await upsertDb.user.upsert({
    where: { user_tenant: { email: 'son@example.com', tenantId: 't1' } },
    create: { email: 'son@example.com', tenantId: 't1', name: 'Created' },
    update: { name: 'Merged' },
  });

  assert.strictEqual(merged.name, 'Merged');
  assert.strictEqual(upsertMergeCalls.length, 1);
  assert.ok(upsertMergeCalls[0].sql.includes('MERGE INTO [dbo].[users] WITH (HOLDLOCK) AS target'));
  assert.ok(upsertMergeCalls[0].sql.includes('target.[email] = @upw_email'));
  assert.ok(upsertMergeCalls[0].sql.includes('target.[tenantId] = @upw_tenantId'));
  assert.strictEqual(upsertMergeCalls[0].params.upw_email, 'son@example.com');
  assert.strictEqual(upsertMergeCalls[0].params.upw_tenantId, 't1');

  const fallbackCalls = [];
  let fallbackSelectCount = 0;
  const fallbackDb = new An5ORM(async (sql, params) => {
    fallbackCalls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) {
      fallbackSelectCount += 1;
      return [{ id: 'u4', email: 'son@example.com', name: fallbackSelectCount >= 3 ? 'Updated' : 'Old' }];
    }
    return [];
  }, upsertMetadata);

  const fallbackResult = await fallbackDb.user.upsert({
    where: { email: { contains: '@example.com' } },
    create: { email: 'son@example.com', tenantId: 't1', name: 'Created' },
    update: { name: 'Updated' },
  });

  assert.strictEqual(fallbackResult.name, 'Updated');
  assert.ok(!fallbackCalls.some((call) => call.sql.includes('MERGE INTO')), 'Complex upsert where should not use MERGE');
  assert.ok(fallbackCalls.some((call) => /^\s*UPDATE/.test(call.sql)), 'Expected complex upsert fallback to update existing row');
  const updateCall = fallbackCalls.find((call) => /^\s*UPDATE/.test(call.sql));
  assert.ok(updateCall.sql.includes('WHERE [email] LIKE @w_email_contains'));
  assert.strictEqual(updateCall.params.w_email_contains, '%@example.com%');

  const nestedCalls = [];
  const nestedMetadata = {
    modelToTable: { user: 'dbo.users', order: 'dbo.orders' },
    modelFields: {
      user: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        name: { ts: 'string', sql: 'NVARCHAR(255)' },
      },
      order: {
        id: { ts: 'string', sql: 'NVARCHAR(1000)' },
        userId: { ts: 'string', sql: 'NVARCHAR(1000)' },
        name: { ts: 'string', sql: 'NVARCHAR(255)' },
      },
    },
    relationMap: {
      user: {
        orders: { modelName: 'order', relationType: 'many', foreignKey: 'userId', localKey: 'id' },
      },
      order: {
        user: { modelName: 'user', relationType: 'one', foreignKey: 'userId', localKey: 'id' },
      },
    },
  };
  const nestedExecutor = Object.assign(
    async (sql, params) => {
      nestedCalls.push({ kind: 'query', sql, params });
      if (/FROM \[dbo\]\.\[users\]/.test(sql)) return [{ id: 'u5', name: 'Parent' }];
      if (/FROM \[dbo\]\.\[orders\]/.test(sql)) return [{ id: params?.id || params?.w_id || 'o', userId: 'u5', name: 'Order' }];
      if (/INSERT INTO \[dbo\]\.\[orders\]/.test(sql)) return [{ id: params?.id || 'o6', userId: params?.userId, name: params?.name }];
      return [{ id: 'o', userId: 'u5', name: params?.name || 'Order' }];
    },
    {
      executeRaw: async (sql, params) => {
        nestedCalls.push({ kind: 'executeRaw', sql, params });
        return 1;
      },
    }
  );
  const nestedDb = new An5ORM(nestedExecutor, nestedMetadata);

  await nestedDb.user.update({
    where: { id: 'u5' },
    data: {
      orders: {
        set: [{ id: 'o2' }],
        disconnect: { id: 'o3' },
        delete: { id: 'o4' },
        update: { where: { id: 'o5' }, data: { name: 'Line' } },
        create: { id: 'o6', name: 'Created child' },
        connect: { id: 'o7' },
      },
    },
  });

  assert.ok(
    !nestedCalls.some((call) => /^\s*UPDATE \[dbo\]\.\[users\] SET\s+WHERE/.test(call.sql)),
    'Nested-only update should not generate an empty parent UPDATE'
  );
  assert.ok(
    nestedCalls.some((call) =>
      call.kind === 'executeRaw' &&
      call.sql.includes('UPDATE [dbo].[orders] SET [userId] = @userId') &&
      call.sql.includes('WHERE [userId] = @w_userId') &&
      call.params.userId === null &&
      call.params.w_userId === 'u5'
    ),
    'Expected nested set to disconnect existing children scoped by parent'
  );
  assert.ok(
    nestedCalls.some((call) => call.kind === 'executeRaw' && call.sql.includes('DELETE FROM [dbo].[orders]') && call.sql.includes('[userId] = @and_1_userId')),
    'Expected nested delete to be scoped by parent'
  );
  assert.ok(
    nestedCalls.some((call) => /^\s*UPDATE \[dbo\]\.\[orders\] SET \[name\] = @name WHERE/.test(call.sql) && call.sql.includes('[userId] = @w_and_1_userId')),
    'Expected nested update to be scoped by parent'
  );
  assert.ok(
    nestedCalls.some((call) => call.sql.includes('INSERT INTO [dbo].[orders]') && call.params.userId === 'u5'),
    'Expected nested create to inject the parent foreign key'
  );

  const oneRelationCalls = [];
  const oneRelationDb = new An5ORM(async (sql, params) => {
    oneRelationCalls.push({ sql, params });
    if (/FROM \[dbo\]\.\[orders\]/.test(sql)) return [{ id: 'o8', userId: 'u1', name: 'Order' }];
    return [{ id: 'o8', userId: params?.userId ?? null, name: 'Order' }];
  }, nestedMetadata);

  await oneRelationDb.order.update({
    where: { id: 'o8' },
    data: { user: { set: { id: 'u9' } } },
  });
  await oneRelationDb.order.update({
    where: { id: 'o8' },
    data: { user: { disconnect: true } },
  });

  const oneRelationUpdates = oneRelationCalls.filter((call) => /^\s*UPDATE \[dbo\]\.\[orders\]/.test(call.sql));
  assert.strictEqual(oneRelationUpdates[0].params.userId, 'u9');
  assert.strictEqual(oneRelationUpdates[1].params.userId, null);

  const rootTxCalls = [];
  const txCalls = [];
  const txExecutor = Object.assign(
    async (sql, params) => {
      txCalls.push({ kind: 'query', sql, params });
      if (/FROM \[dbo\]\.\[users\]/.test(sql)) return [{ id: 'tx-user', name: 'Tx Parent' }];
      if (/FROM \[dbo\]\.\[orders\]/.test(sql)) return [{ id: params?.id || params?.w_id || 'tx-order', userId: 'tx-user', name: 'Tx Order' }];
      if (/INSERT INTO \[dbo\]\.\[orders\]/.test(sql)) return [{ id: params?.id || 'tx-created', userId: params?.userId, name: params?.name }];
      return [];
    },
    {
      executeRaw: async (sql, params) => {
        txCalls.push({ kind: 'executeRaw', sql, params });
        return 3;
      },
    }
  );
  const rootExecutor = Object.assign(
    async (sql, params) => {
      rootTxCalls.push({ kind: 'query', sql, params });
      return [];
    },
    {
      executeRaw: async (sql, params) => {
        rootTxCalls.push({ kind: 'executeRaw', sql, params });
        return 0;
      },
      transaction: async (fn) => {
        rootTxCalls.push({ kind: 'begin' });
        const result = await fn(txExecutor);
        rootTxCalls.push({ kind: 'commit' });
        return result;
      },
    }
  );
  const txDb = new An5ORM(rootExecutor, nestedMetadata);

  const txResult = await txDb.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: 'tx-user' }, data: { name: 'Inside tx' } });
    await tx.user.update({
      where: { id: 'tx-user' },
      data: { orders: { create: { id: 'tx-child', name: 'Child in tx' } } },
    });
    const rawCount = await tx.$executeRaw`UPDATE dbo.users SET name = ${'Raw tx'}`;
    return { updated, rawCount };
  });

  assert.deepStrictEqual(txResult, { updated: { count: 3 }, rawCount: 3 });
  assert.deepStrictEqual(rootTxCalls.map((call) => call.kind), ['begin', 'commit']);
  assert.ok(txCalls.some((call) => call.kind === 'executeRaw' && call.sql.includes('UPDATE [dbo].[users] SET [name] = @name')));
  assert.ok(txCalls.some((call) => call.sql.includes('INSERT INTO [dbo].[orders]') && call.params.userId === 'tx-user'));
  assert.ok(txCalls.some((call) => call.kind === 'executeRaw' && call.sql.includes('UPDATE dbo.users SET name = @p_0')));

  console.log('an5Orm runtime test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
