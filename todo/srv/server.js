const cds = require('@sap/cds')
const cors = require('cors')
const express = require('express')

const ONESIGNAL_APP_ID = 'f057a71a-c30e-4191-a9c1-d8b1ce981cbf'

cds.on('bootstrap', app => {
  app.use(cors())

  // Proxies the OneSignal push send so the REST API key stays server-side —
  // OneSignal's REST API has no CORS headers, so the browser can never call
  // it directly. Set ONESIGNAL_REST_API_KEY in a local .env file (cds loads
  // it automatically); never commit the key itself.
  app.post('/notify', express.json(), async (req, res) => {
    const key = process.env.ONESIGNAL_REST_API_KEY
    if (!key) {
      return res.status(500).json({ error: 'ONESIGNAL_REST_API_KEY is not set on the server' })
    }
    try {
      const onesignalRes = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${key}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          included_segments: ['All'],
          contents: { en: req.body.body },
          headings: { en: req.body.heading || 'Daylist reminder' },
        }),
      })
      const data = await onesignalRes.json()
      res.status(onesignalRes.status).json(data)
    } catch (err) {
      res.status(502).json({ error: err.message })
    }
  })
})

module.exports = cds.server