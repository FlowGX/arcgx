/**
 * Entrypoint do worker de scan (inferência de item).
 * Toda a lógica está em `worker-runtime.ts`; este arquivo existe para que o
 * `WorkerPool` tenha um script estável por papel.
 */
import './worker-runtime.js';