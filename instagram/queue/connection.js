import { CFG } from '../config.js';
import { Redis } from 'ioredis';

export const redis = new Redis(CFG.REDIS_URL);
export const connection = { client: redis, subscriber: new Redis(CFG.REDIS_URL) };