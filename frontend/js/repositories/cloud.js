// A page owns one account snapshot. A revision conflict requires a reload;
// retrying never silently overwrites another device's changes.
export function createCloudDataStore({ request }) {
  let snapshot = null;
  let revision = null;
  let initialRead = null;
  let writes = Promise.resolve();
  const copy = value => JSON.parse(JSON.stringify(value));

  async function read() {
    if (!initialRead) {
      initialRead = request('/api/data').then(result => {
        snapshot = result.data;
        revision = result.revision;
      }).catch(error => {
        initialRead = null;
        throw error;
      });
    }
    await initialRead;
  }

  function mutate(change) {
    const write = writes.then(async () => {
      await read();
      const next = copy(snapshot);
      change(next);
      const result = await request('/api/data', { method:'PUT', body:{ revision, data:next } });
      snapshot = next;
      revision = result.revision;
    });
    writes = write.catch(() => {});
    return write;
  }

  function repository(name) {
    return Object.freeze({
      async list() {
        await writes;
        await read();
        return copy(snapshot[name]);
      },
      async first() {
        return (await this.list())[0] || null;
      },
      save(value) {
        return this.saveMany([value]);
      },
      saveMany(values) {
        const records = copy(values);
        return mutate(data => {
          const byId = new Map(data[name].map(record => [record.id, record]));
          records.forEach(record => byId.set(record.id, record));
          data[name] = [...byId.values()];
        });
      },
      remove(id) {
        return this.removeMany([id]);
      },
      removeMany(ids) {
        const removed = new Set(ids);
        return mutate(data => { data[name] = data[name].filter(record => !removed.has(record.id)); });
      },
      clear() {
        return mutate(data => { data[name] = []; });
      },
    });
  }

  return {
    repository,
    replace(data) {
      const replacement = copy(data);
      return mutate(next => {
        for (const name of ['transactions', 'settings', 'budgetPlans', 'budgetItems']) next[name] = replacement[name] || [];
      });
    },
    whenIdle:() => writes,
  };
}
