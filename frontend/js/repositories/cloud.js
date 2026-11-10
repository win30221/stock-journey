// A page owns one account snapshot. A revision conflict requires a reload;
// retrying never silently overwrites another device's changes.
export function createCloudDataStore({ request, onWriteState = () => {} }) {
  let snapshot = null;
  let revision = null;
  let initialRead = null;
  let writes = Promise.resolve();
  let pendingWrites = 0;
  let writeError = null;
  const copy = value => JSON.parse(JSON.stringify(value));

  function publishWriteState() {
    try {
      onWriteState({ state:pendingWrites ? 'saving' : writeError ? 'error' : 'saved', error:writeError });
    } catch (error) {
      console.error('Cloud write status listener failed:', error);
    }
  }

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
    if (!pendingWrites) writeError = null;
    pendingWrites++;
    publishWriteState();
    const write = writes.then(async () => {
      await read();
      const next = copy(snapshot);
      change(next);
      const result = await request('/api/data', { method:'PUT', body:{ revision, data:next } });
      snapshot = next;
      revision = result.revision;
    });
    const observed = write.catch(error => {
      writeError = error;
      throw error;
    }).finally(() => {
      pendingWrites--;
      publishWriteState();
    });
    writes = observed.catch(() => {});
    return observed;
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
