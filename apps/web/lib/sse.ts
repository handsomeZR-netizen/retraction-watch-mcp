export type SseSink = {
  write: (data: unknown) => void;
  close: () => void;
};

export function createSseStream(): {
  stream: ReadableStream<Uint8Array>;
  sink: SseSink;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });
  const sink: SseSink = {
    write: (data) => {
      if (!controller) return;
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    },
    close: () => {
      try {
        controller?.close();
      } catch {
        // already closed
      }
      controller = null;
    },
  };
  return { stream, sink };
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
