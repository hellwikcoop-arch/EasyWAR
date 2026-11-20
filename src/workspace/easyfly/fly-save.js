// A document and its immutable data snapshot must be captured at enqueue time.
// In particular, unmount() clears the UI's current document synchronously while
// the previous asynchronous profile write may only start in a later microtask.
export function createProfileSaveQueue({ write, encode, fingerprint, onResult = () => {} }) {
  let queue = Promise.resolve();

  return function enqueue(document) {
    const target = document?.stored ? document : null;
    const snapshot = target?.data;

    const run = async () => {
      if (!target) return true;
      try {
        await write(encode(snapshot));
        target.savedFp = fingerprint(snapshot);
        onResult({ target, ok: true });
        return true;
      } catch (error) {
        onResult({ target, ok: false, error });
        return false;
      }
    };

    queue = queue.then(run, run);
    return queue;
  };
}
