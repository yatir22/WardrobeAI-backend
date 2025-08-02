const express = require('express');
const mongoose = require('mongoose');
const WardrobeUser = require('./models/WardrobeUser');
const app = express();
app.use(express.json());

// Create Account Endpoint
app.post('/create', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    let username = name && name.trim() ? name.trim() : email.split('@')[0];
    // Check if email or username already exists
    const existing = await WardrobeUser.findOne({ $or: [ { email }, { username } ] });
    if (existing) {
      return res.status(409).json({ error: 'Email or username already registered.' });
    }
    const user = new WardrobeUser({ email, username, password });
    await user.save();
    res.json({ message: 'Account created successfully', user: { email, username, createdAt: user.createdAt } });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Login Endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email && !username) {
      return res.status(400).json({ error: 'Email or username required.' });
    }
    const user = await WardrobeUser.findOne(email ? { email } : { username });
    if (!user) {
      return res.status(404).json({ error: 'Email/username not registered.' });
    }
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    res.json({ message: 'Login successful', user: { email: user.email, username: user.username, createdAt: user.createdAt } });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = app;
