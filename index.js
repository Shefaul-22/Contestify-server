const express = require('express');
const app = express();
// const cors = require('cors')

const port = process.env.PORT || 3000;
require('dotenv').config();


app.get('/', (req, res) => {
    res.send('Contestify Server is running')
})

app.listen(port, () => {
    console.log(`Contestify app is running on port ${port}`)
})
