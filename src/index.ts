'use strict';

import * as ansi from 'ansi-escapes';
import * as EventEmitter from 'events';

interface InStream extends EventEmitter {
    setRawMode(state: boolean): void;
    pause(): void;
    resume(): void;
    read(): void;
    setEncoding(enc: string): void;
}

function isReadableStream(test: unknown | InStream): test is InStream {
    return test instanceof EventEmitter &&
      typeof (<InStream>test).setRawMode === 'function' &&
      typeof (<InStream>test).pause === 'function' &&
      typeof (<InStream>test).resume === 'function' &&
      typeof (<InStream>test).read === 'function' &&
      typeof (<InStream>test).setEncoding === 'function';
}

interface OutStream extends EventEmitter {
    write(s: string): void;
    end(): void;
}

function isWritableStream(test: unknown | OutStream): test is OutStream {
    return test instanceof EventEmitter &&
      typeof (<OutStream>test).write === 'function';
}

const { stdin, stdout, stderr } = process;

type Options = {
    def?: string;
    mask?: boolean | string;
    required?: boolean;
    output?: unknown;
    input?: unknown;
}

function read(
  ask: string,
  outstream: OutStream,
  instream: InStream,
  {
    def,
    mask = true,
    required = typeof def === 'undefined'
  } : Options
): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = '';
    outstream.write(ansi.eraseLine);
    outstream.write(ansi.cursorLeft);
    outstream.write(ask);
    instream.resume();
    instream.setRawMode(true);

    const maskchar = typeof mask === 'string' ? mask : mask ? '*' : null;
    function maskInput(c = input): string {
      return maskchar === null ? c : maskchar === '' ? '' : maskchar.repeat(c.length);
    }

    function stop(): void {
      outstream.write('\n' + ansi.cursorShow);
      instream.removeListener('data', process_char);
      instream.setRawMode(false);
      instream.pause();
    }

    function enter(): void {
      if (required && input.length === 0) return;
      stop();
      input = input.replace(/\r$/, '')
      if(input.length === 0 && typeof def === 'string' && def.length > 0) {
        input = def;
      }
      resolve(input);
    }

    function ctrlc(): void {
      stop();
      reject(new Error('SIGINT'));
    }

    function backspace(): void {
      if (input.length === 0) return;
      input = input.substr(0, input.length - 1);
      outstream.write(ansi.cursorBackward(1));
      outstream.write(ansi.eraseEndLine);
    }

    function process_char(c: string): void {
      switch (c) {
        case '\u0004': // Ctrl-d
        case '\r':
        case '\n':
          return enter();
        case '\u0003': // Ctrl-c
          return ctrlc();
        default:
          // backspace
          if (c.charCodeAt(0) === 127) return backspace();
          else {
            input += c;
            outstream.write(maskInput(c));
            return;
          }
      }
    }

    stdin.on('data', process_char);
  });
}

const cachedOptions = {};

export async function prompt(ask: string, options: Options = cachedOptions): Promise<string> {
  let input = '';
  const required = options.required || typeof options.def === 'undefined'
  const outstream = options.output === 'stderr' ? stderr :
    options.output === 'stdout' ? stdout :
    isWritableStream(options.output) ? options.output : stdout;
  const instream = options.input === 'stdin' ? stdin :
    isReadableStream(options.input) ? options.input : stdin;

  if (typeof instream.setRawMode !== 'function') {
      throw new Error('Must be able to set input stream to raw mode.');
  }

  Object.assign(cachedOptions, options);

  instream.setEncoding('utf8');

  do {
    input = await read(ask, outstream, <InStream>instream, options);
  } while (required && input.length === 0);

  return input;
};