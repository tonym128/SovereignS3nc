import { Buffer } from 'buffer';
import process from 'process';

const g = typeof window !== 'undefined' ? window : self;

g.Buffer = Buffer;
g.process = process;
g.global = g;
