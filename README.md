# liveserve

Zero-dependency minimal web server with live reload.

Usage:

```js
import { serve } from 'liveserve'

serve({
  root: '/foo/bar',
  debounce: 50,          // default: 100 ms
  hostname: 'localhost', // default: localhost
  port: 1234             // default: 3000
})
```
