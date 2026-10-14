This local-safe relay is derived from `grab/cursor-talk-to-figma-mcp` at upstream revision
`ddd90f3a6d454ea0b2fc29f1b084f50fd062b880`, file `src/socket.ts`.

The relay preserves the upstream join, message broadcast, and progress_update WebSocket
protocol. BA Studio's copy binds only to `127.0.0.1` and omits payload logging.
Recheck protocol compatibility before changing the pinned upstream revision.

Upstream source is distributed under the MIT License. Copyright (c) 2025 Github User
sonnylazuardi.

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions: The above
copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
