/*
 * Adfinia web-push service worker — US-PS-WEBPUSH-001.
 *
 * Host this file at your web root (e.g. https://app.example.com/adfinia-sw.js)
 * so it can claim the widest scope. A service worker can only control pages
 * at or below its own URL path, so it must NOT be bundled into your app's JS.
 *
 * Copy it from:
 *   node_modules/@adfinia/sdk-web/dist/adfinia-sw.js   (after npm install)
 *   or src/service-worker/adfinia-sw.js in the repo.
 *
 * If you serve it from a sub-path, set the `Service-Worker-Allowed` response
 * header to widen the scope, and pass `scope` to registerWebPush().
 *
 * Responsibilities:
 *   - `push`            show the notification + emit a `push_received` beacon
 *   - `notificationclick` focus/open the target URL + emit `push_clicked`
 *
 * The events are POSTed to the Adfinia track endpoint as a beacon-style
 * keepalive fetch. The push payload (sent by the Adfinia push dispatcher)
 * is expected to be JSON of the shape:
 *
 *   {
 *     "title": "...", "body": "...", "icon": "...", "url": "...",
 *     "tag": "...",
 *     "adfinia": {
 *       "ingest": "https://events.adfinia.com",   // ingest host
 *       "write_key": "pk_live_...",               // tenant write key
 *       "anonymous_id": "...", "external_id": "...", "customer_id": "...",
 *       "campaign_id": "...", "journey_id": "...", "message_id": "..."
 *     }
 *   }
 */

self.addEventListener('push', function (event) {
  var data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }

  var title = data.title || 'Notification'
  var options = {
    body: data.body || '',
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    data: {
      url: data.url || '/',
      adfinia: data.adfinia || {},
    },
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      adfiniaTrack('push_received', data.adfinia),
    ])
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var d = (event.notification.data && event.notification.data) || {}
  var url = d.url || '/'

  event.waitUntil(
    Promise.all([
      adfiniaTrack('push_clicked', d.adfinia),
      clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (windowClients) {
          for (var i = 0; i < windowClients.length; i++) {
            var c = windowClients[i]
            if (c.url === url && 'focus' in c) return c.focus()
          }
          if (clients.openWindow) return clients.openWindow(url)
        }),
    ])
  )
})

// POST a track event for a push interaction. Best-effort; never throws.
function adfiniaTrack(eventName, adf) {
  adf = adf || {}
  var ingest = adf.ingest
  var writeKey = adf.write_key
  if (!ingest || !writeKey) return Promise.resolve()

  var body = {
    event_name: eventName,
    anonymous_id: adf.anonymous_id,
    external_id: adf.external_id,
    customer_id: adf.customer_id,
    properties: {
      channel: 'web_push',
      campaign_id: adf.campaign_id,
      journey_id: adf.journey_id,
      message_id: adf.message_id,
    },
    occurred_at: new Date().toISOString(),
  }

  return fetch(ingest + '/api/v1/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + writeKey,
      'x-adfinia-sdk-version': 'adfinia-sdk-web@sw',
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(function () {
    /* fire-and-forget */
  })
}
