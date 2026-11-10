// A cancelled task must finish its in-flight writes before data is replaced.
export function createCancellableTask() {
  let current = null;
  return {
    get busy() { return current !== null; },
    run(action) {
      if (current) return current.promise;
      const controller = new AbortController();
      const task = {
        signal: controller.signal,
        check() {
          if (current !== task || controller.signal.aborted) {
            throw Object.assign(Error('作業已取消'), { name:'AbortError' });
          }
        },
      };
      current = task;
      task.abort = () => controller.abort();
      task.promise = Promise.resolve().then(() => action(task)).finally(() => {
        if (current === task) current = null;
      });
      return task.promise;
    },
    async cancel() {
      const task = current;
      if (!task) return;
      task.abort();
      try { await task.promise; } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    },
  };
}

// Capture values at input time; delayed writes never read a replaced page's DOM.
export function createAutosave(write, { delay = 500, onError = () => {} } = {}) {
  let timer = null, pending = null, generation = 0, queue = Promise.resolve();
  let latestValue = {}, latestOnSaved;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return queue;
    const job = pending, version = generation;
    pending = null;
    queue = queue.then(async () => {
      if (version !== generation) return true;
      try {
        await write(job.value);
        if (version === generation) job.onSaved?.();
        return true;
      } catch (error) {
        if (version === generation) onError(error, () => {
          if(version !== generation)return Promise.resolve();
          // Include newer writes already queued or completed, not just pending input.
          pending = { value:{ ...latestValue }, onSaved:latestOnSaved };
          return flush();
        });
        return false;
      }
    });
    return queue;
  }
  return {
    schedule(value, onSaved) {
      latestValue = { ...latestValue, ...value };
      latestOnSaved = onSaved;
      pending = { value:{ ...latestValue }, onSaved };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    async cancel() {
      generation++;
      clearTimeout(timer);
      pending = null;
      latestValue = {};
      latestOnSaved = undefined;
      await queue;
    },
  };
}
