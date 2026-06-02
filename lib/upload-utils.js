/**
 * Run tasks with limited concurrency.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} concurrency
 * @returns {Promise<Array<any>>}
 */
export async function runWithConcurrency(tasks, concurrency = 3) {
  const results = new Array(tasks.length)
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++
      results[currentIndex] = await tasks[currentIndex]()
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
