import fs from "node:fs";
import { JOBS_FILE, ensureDataDirs } from "./paths";
import type { Job } from "./types";

function readAll(): Job[] {
  try {
    if (!fs.existsSync(JOBS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as Job[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(jobs: Job[]) {
  ensureDataDirs();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

export function listJobs(): Job[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(id: string): Job | undefined {
  return readAll().find((job) => job.id === id || job.arkId === id);
}

export function upsertJob(job: Job): Job {
  const jobs = readAll();
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) jobs[index] = job;
  else jobs.unshift(job);
  writeAll(jobs);
  return job;
}

export function patchJob(id: string, patch: Partial<Job>): Job | undefined {
  const jobs = readAll();
  const index = jobs.findIndex((item) => item.id === id || item.arkId === id);
  if (index < 0) return undefined;
  jobs[index] = { ...jobs[index], ...patch, updatedAt: Date.now() };
  writeAll(jobs);
  return jobs[index];
}
