const { ObjectId } = require('mongodb')
const shortUrl = require('../models/shortUrl')
const validUrl = require('valid-url')
const { validationResult } = require('express-validator')
const UserAgent = require('user-agents')
const geoip = require('geoip-lite')

const Url = require('../models/shortUrl')
const Metrics = require('../models/metrics')
const moment = require('moment')

exports.urlShortener = async (req, res, next) => {
  const title = req.body.title
  const fullUrl = req.body.fullUrl
  const customShortUrl = req.body.customShortUrl
  const userId = req.userId

  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(422).json({
      errorMessage: errors.array()
    })
  }

  try {
    if (!validUrl.isUri(fullUrl)) {
      const err = new Error('Entered URL is invalid')
      err.statusCode = 422
      throw err
    }
    let urlObj = await shortUrl.findOne({ userId: userId, full: req.body.fullUrl })

    // If the orignal url is not allready present
    if (!urlObj) {
      if (customShortUrl) {
        const customUrl = await shortUrl.findOne({ short: customShortUrl })
        if (customUrl) {
          const err = new Error('This short name for the URL is not available. Please choose a different one.')
          err.statusCode = 409
          throw err
        }
      }
      urlObj = await shortUrl.create({
        title: title,
        full: fullUrl,
        short: customShortUrl,
        userId: userId
      })
    }
    res.status(201).json({
      shortUrl: urlObj.short
    })
  } catch (err) {
    return next(err)
  }
}

exports.editUrl = async (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(422).json({
      errorMessage: errors.array()
    })
  }

  try {
    const urlId = req.body.urlId
    const updatedTitle = req.body.title
    const updatedFullUrl = req.body.fullUrl
    const updatedCustomShortUrl = req.body.customShortUrl

    const id = ObjectId(urlId)
    const editUrl = await Url.findById(id)

    if (!editUrl) {
      const error = new Error('Invalid url id')
      error.statusCode = 404
      throw error
    }
    if (editUrl.userId.toString() !== req.userId) {
      const error = new Error('Not authorized')
      error.statusCode = 403
      throw error
    }
    editUrl.title = updatedTitle
    editUrl.full = updatedFullUrl
    editUrl.short = updatedCustomShortUrl

    await editUrl.save()
    res.status(200).send(editUrl)
  } catch (err) {
    const error = new Error(err)
    error.StatusCode = 500
    return next(error)
  }
}

exports.redirectToOrignalUrl = async (req, res, next) => {
  const userAgent = new UserAgent()
  let ipAddress = req.ip
  const today = moment().format('DD-MM-YYYY')

  const device = userAgent.deviceCategory
  if (ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') {
    // ipAddress = '207.233.175.255'
    // ipAddress = '117.233.175.255'
    ipAddress = '2.57.169.255'
  }
  const geo = geoip.lookup(ipAddress)
  const country = geo.country

  const shortParam = req.params.shortUrl
  const urlObj = await shortUrl.findOne({ short: shortParam })

  if (!urlObj) return res.sendStatus(404)

  urlObj.clicks++
  urlObj.save()

  const metricsObj = await Metrics.findOne({ urlId: urlObj._id, country: country, device: device, date: today })
  if (!metricsObj) {
    await Metrics.create({
      urlId: urlObj._id,
      country: country,
      device: device,
      clicks: 1
    })
  } else {
    metricsObj.clicks++
    metricsObj.save()
  }
  res.redirect(urlObj.full)
}

exports.locationMetrics = async (req, res, next) => {
  const urlParam = req.params.urlId
  const startDate = req.body.startDate
  const endDate = req.body.endDate
  const map = new Map()
  let totalClicks = 0
  const metricsArray = []

  try {
    const id = ObjectId(urlParam)
    const reqUrl = await Url.findById(id)

    if (reqUrl.userId.toString() !== req.userId) {
      const error = new Error('Not authorized')
      error.statusCode = 403
      throw error
    }
    const metricsObj = await Metrics.find({ urlId: urlParam, date: { $gte: startDate, $lte: endDate } })
    metricsObj.forEach(obj => {
      totalClicks += obj.clicks
      if (map.has(obj.country)) {
        const clicks = obj.clicks + map.get(obj.country)
        map.set(obj.country, clicks)
      } else {
        map.set(obj.country, obj.clicks)
      }
    })
    map.forEach((value, key) => {
      const obj = {
        country: key,
        clicks: value,
        percentage: ((value / totalClicks) * 100).toFixed(2)
      }
      metricsArray.push(obj)
    })

    res.status(200).send(metricsArray)
  } catch (err) {
    next(err)
  }
}
exports.deviceMetrics = async (req, res, next) => {
  const urlParam = req.params.urlId
  const startDate = req.body.startDate
  const endDate = req.body.endDate
  const map = new Map()
  let totalClicks = 0
  const metricsArray = []

  try {
    const id = ObjectId(urlParam)
    const reqUrl = await Url.findById(id)

    if (reqUrl.userId.toString() !== req.userId) {
      const error = new Error('Not authorized')
      error.statusCode = 403
      throw error
    }
    const metricsObj = await Metrics.find({ urlId: urlParam, date: { $gte: startDate, $lte: endDate } })
    metricsObj.forEach(obj => {
      totalClicks += obj.clicks
      if (map.has(obj.device)) {
        const clicks = obj.clicks + map.get(obj.device)
        map.set(obj.device, clicks)
      } else {
        map.set(obj.device, obj.clicks)
      }
    })
    map.forEach((value, key) => {
      const obj = {
        device: key,
        clicks: value,
        percentage: ((value / totalClicks) * 100).toFixed(2)
      }
      metricsArray.push(obj)
    })

    res.status(200).send(metricsArray)
  } catch (err) {
    next(err)
  }
}

exports.devicePerLocation = async (req, res, next) => {
  const urlParam = req.params.urlId
  const startDate = req.body.startDate
  const endDate = req.body.endDate
  const loc = req.body.loc
  const map = new Map()
  let totalClicks = 0
  const metricsArray = []

  try {
    const id = ObjectId(urlParam)
    const reqUrl = await Url.findById(id)

    if (reqUrl.userId.toString() !== req.userId) {
      const error = new Error('Not authorized')
      error.statusCode = 403
      throw error
    }
    const metricsObj = await Metrics.find({ urlId: urlParam, date: { $gte: startDate, $lte: endDate }, country: loc })
    metricsObj.forEach(obj => {
      totalClicks += obj.clicks
      if (map.has(obj.device)) {
        const clicks = obj.clicks + map.get(obj.device)
        map.set(obj.device, clicks)
      } else {
        map.set(obj.device, obj.clicks)
      }
    })
    map.forEach((value, key) => {
      const obj = {
        device: key,
        clicks: value,
        percentage: ((value / totalClicks) * 100).toFixed(2)
      }
      metricsArray.push(obj)
    })

    res.status(200).json({ metricsArray })
  } catch (err) {
    next(err)
  }
}
