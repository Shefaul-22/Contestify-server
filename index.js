const express = require('express');
const app = express();
const cors = require('cors')
require('dotenv').config();

const port = process.env.PORT || 3000;


// middleware
app.use(cors())
app.use(express.json())


// firebase 

const admin = require("firebase-admin");

const serviceAccount = require("./contestify-d5372-firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    // console.log(token);

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        // console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


}



app.get('/', (req, res) => {
    res.send('Contestify Server is running')
})


const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/?appName=crud-server-practice`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('contestify-db');
        const usersCollection = db.collection('users')


        // Prevent duplicate user
        await usersCollection.createIndex(
            { email: 1 },
            { unique: true }
        );

        app.post('/users', async (req, res) => {

            const user = req.body;
            user.role = "user";
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);

        })

        // get specific user (email)
        app.get('/users', verifyFBToken, async (req, res) => {

            try {

                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                const result = await usersCollection.findOne({ email });
                res.send(result);

            } catch (err) {
                res.status(500).send({ message: "Failed to fetch user" });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Contestify app is running on port ${port}`)
})
