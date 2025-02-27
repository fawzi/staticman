'use strict'

const path = require('path')
const config = require(path.join(__dirname, '/../config'))
const errorHandler = require('../lib/ErrorHandler')
const reCaptcha = require('express-recaptcha')
const Staticman = require('../lib/Staticman')
const universalAnalytics = require('universal-analytics')

function checkRecaptcha (staticman, req) {
  return new Promise((resolve, reject) => {
    staticman.getSiteConfig().then(siteConfig => {
      if (!siteConfig.get('reCaptcha.enabled')) {
        return resolve(false)
      }

      const reCaptchaOptions = req.body.options && req.body.options.reCaptcha

      if (!reCaptchaOptions || !reCaptchaOptions.siteKey) {
        console.log('recaptcha missing credentials')
        return reject(errorHandler('RECAPTCHA_MISSING_CREDENTIALS'))
      }

      let decryptedSecret = siteConfig.get('reCaptcha.secret')
      let siteKey = siteConfig.get('reCaptcha.siteKey')
      if (
        reCaptchaOptions.siteKey !== siteKey
      ) {
        console.log('recaptcha invalid site key')
        return reject(errorHandler('RECAPTCHA_CONFIG_MISMATCH'))
      }

      // new version will use reCaptcha.RecaptchaV2 instead of init
      reCaptcha.init(siteKey, decryptedSecret)
      reCaptcha.verify(req, (err, data) => {
        if (err) {
          console.log('recaptcha error ' + JSON.stringify(err))
          return reject(errorHandler(err))
        }
        let allowedOrigins = siteConfig.get('allowedOrigins')
        if (allowedOrigins && !allowedOrigins.includes(data.hostname)) {
          let msg = 'recaptcha error, replay attack, captcha from ' + data.hostname + ' and not ' + JSON.stringify(allowedOrigins)
          console.log(msg)
          return reject(errorHandler({msg:msg}))
        }
        return resolve(true)
      })
    }).catch(function (err) {
      console.log('recaptcha raised error '+ JSON.stringify(err))
      reject(err)})
  })
}

function createConfigObject (apiVersion, property) {
  let remoteConfig = {}

  if (apiVersion === '1') {
    remoteConfig.file = '_config.yml'
    remoteConfig.path = 'staticman'
  } else {
    remoteConfig.file = 'staticman.yml'
    remoteConfig.path = property || ''
  }

  return remoteConfig
}

function process (staticman, req, res) {
  const ua = config.get('analytics.uaTrackingId')
    ? universalAnalytics(config.get('analytics.uaTrackingId'))
    : null
  const fields = req.query.fields || req.body.fields
  const options = req.query.options || req.body.options || {}

  return staticman.processEntry(fields, options).then(data => {
    sendResponse(res, {
      redirect: data.redirect,
      fields: data.fields
    })

    if (ua) {
      ua.event('Entries', 'New entry').send()
    }
  })
}

function sendResponse (res, data) {
  const error = data && data.err
  const statusCode = error ? 500 : 200

  if (!error && data.redirect) {
    return res.redirect(data.redirect)
  }

  if (error && data.redirectError) {
    return res.redirect(data.redirectError)
  }

  let payload = {
    success: !error
  }

  if (error && error._smErrorCode) {
    const errorCode = errorHandler.getInstance().getErrorCode(error._smErrorCode)
    const errorMessage = errorHandler.getInstance().getMessage(error._smErrorCode)

    if (errorMessage) {
      payload.message = errorMessage
    }

    if (error.data) {
      payload.data = error.data
    }

    if (error) {
      payload.rawError = error
    }

    payload.errorCode = errorCode
  } else if (error) {
    payload.rawError = data.err.toString()
  } else {
    payload.fields = data.fields
  }

  res.status(statusCode).send(payload)
}

module.exports = async (req, res, next) => {
  const staticman = await new Staticman(req.params)

  staticman.setConfigPath()
  staticman.setIp(req.headers['x-forwarded-for'] || req.connection.remoteAddress)
  staticman.setUserAgent(req.headers['user-agent'])

  return checkRecaptcha(staticman, req)
    .then(usedRecaptcha => process(staticman, req, res))
    .catch(err => sendResponse(res, {
      err,
      redirect: req.body.options && req.body.options.redirect,
      redirectError: req.body.options && req.body.options.redirectError
    }))
}

module.exports.checkRecaptcha = checkRecaptcha
module.exports.createConfigObject = createConfigObject
module.exports.process = process
module.exports.sendResponse = sendResponse
