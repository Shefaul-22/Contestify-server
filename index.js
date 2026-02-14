const express = require('express');
const app = express();
const cors = require('cors')
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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


    if (!token || !token.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'unauthorized access' });
    }


    // if (!token) {
    //     return res.status(401).send({ message: 'unauthorized access' })
    // }

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


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
        const contestsCollection = db.collection('contests');
        const paymentCollection = db.collection('payments');
        const submissionsCollection = db.collection('submissions');




        // Prevent duplicate user
        await usersCollection.createIndex(
            { email: 1 },
            { unique: true }
        );

        // Prevent duplicate contest per creator
        await contestsCollection.createIndex(
            { name: 1, creatorEmail: 1 },
            { unique: true }
        );

        await submissionsCollection.createIndex(
            { contestId: 1, participantEmail: 1 },
            { unique: true }
        );

        // prevent duplicate payment
        await paymentCollection.createIndex(
            { transactionId: 1 },
            { unique: true }
        );




        // -------User related api -----------
        app.post('/users', verifyFBToken, async (req, res) => {
            try {

                const user = req.body;

                user.email = req.decoded_email;
                user.role = "user";
                user.createdAt = new Date();

                // if (req.decoded_email !== user.email) {
                //     return res.status(403).send({ message: 'Forbidden access' });
                // }


                const result = await usersCollection.insertOne(user);
                res.send(result);

            } catch (error) {

                if (error.code === 11000) {
                    return res.send({ message: 'user exists' });
                }

                res.status(500).send({ message: 'Failed to create user' });
            }
        });


        // get specific user (email)
        app.get('/users', verifyFBToken, async (req, res) => {

            try {

                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                if (req.decoded_email !== email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }


                const result = await usersCollection.findOne({ email });
                res.send(result);

            } catch (err) {
                res.status(500).send({ message: "Failed to fetch user" });
            }
        });

        // ------Contest related api--------

        // Create Contest
        app.post('/contests', verifyFBToken, async (req, res) => {

            try {

                const contest = req.body;

                if (!contest?.name || !contest?.creatorEmail) {
                    return res.status(400).send({ message: 'Missing required fields' });
                }

                // security check (token email must match creatorEmail)
                if (req.decoded_email !== contest.creatorEmail) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                contest.status = 'pending';
                contest.createdAt = new Date();

                const result = await contestsCollection.insertOne(contest);

                res.send(result);

            } catch (error) {

                console.error(error);

                // Duplicate contest error
                if (error.code === 11000) {
                    return res.status(400).send({
                        message: 'You already created a contest with this name'
                    });
                }

                res.status(500).send({
                    message: 'Failed to create contest'
                });
            }

        });

        // Get approved contests
        // app.get('/contests', async (req, res) => {
        //     try {

        //         const result = await contestsCollection
        //             .find({ status: 'approved' })
        //             .sort({ createdAt: -1 })
        //             .toArray();

        //         res.send(result);

        //     } catch (error) {
        //         console.error(error);
        //         res.status(500).send({ message: 'Failed to fetch contests' });
        //     }
        // });

        app.get('/contests', async (req, res) => {
            try {

                const { page = 1, search = "", category = "", status = "" } = req.query;

                const limit = 6;
                const skip = (Number(page) - 1) * limit;


                const query = {};

                if (status) {
                    query.status = status;
                } else {
                    query.status = 'approved';
                }

                // Search by contest name
                if (search) {
                    query.name = {
                        $regex: search,
                        $options: 'i'
                    };
                }

                // Filter by category
                if (category) {
                    query.contestType = category;
                }



                const total = await contestsCollection.countDocuments(query);

                const contests = await contestsCollection
                    .find(query)
                    .sort({ deadline: 1, createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    contests,
                    total,
                    totalPages: Math.ceil(total / limit),
                    currentPage: Number(page)
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to fetch contests' });
            }
        });

        app.get('/contests/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ message: 'Invalid id' });
            }

            const contest = await contestsCollection.findOne({
                _id: new ObjectId(id)
            });

            if (!contest) {
                return res.status(404).send({ message: 'Contest not found' });
            }

            // If contest is approved → anyone logged in can see
            if (contest.status === 'approved') {
                return res.send(contest);
            }

            // If not approved → only creator can see
            if (contest.creatorEmail !== req.decoded_email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            res.send(contest);
        });

        // --contest registration payment checkout & success

        app.post('/create-contest-payment-checkout', verifyFBToken, async (req, res) => {
            try {
                

                const { contestId } = req.body;
                const email = req.decoded_email;

                const contest = await contestsCollection.findOne({
                    _id: new ObjectId(contestId)
                });

                if (!contest) {
                    return res.status(404).send({ message: "Contest not found" });
                }

                // check already registered or not
                if (contest.participants?.includes(req.decoded_email)) {
                    return res.status(400).send({ message: "Already registered" });
                }

                // deadline check
                if (new Date(contest.deadline) < new Date()) {
                    return res.status(400).send({ message: "Contest already ended" });
                }

                const amount = parseInt(contest.entryFee) * 100; // BDT

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'bdt',
                                unit_amount: amount,
                                product_data: {
                                    name: `Contest Registration: ${contest.name}`,
                                },
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    metadata: {
                        contestId,
                        email,
                        contestName: contest.name
                    },
                    customer_email: email,
                    success_url: `${process.env.SITE_DOMAIN}/contests/${contestId}?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/contests/${contestId}?payment=cancelled`,
                });

                res.send({ url: session.url });

            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to create checkout session" });
            }
        });

        app.patch('/contest-payment-success', verifyFBToken, async (req, res) => {
            try {

                const sessionId = req.query.session_id;

                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status !== 'paid') {
                    return res.send({ success: false, message: "Payment not completed" });
                }


                const { contestId, email, contestName } = session.metadata;

                if (req.decoded_email !== email) {
                    return res.status(403).send({ message: "Forbidden access" });
                }


                // Duplicate check
                const existingPayment = await paymentCollection.findOne({
                    transactionId: session.payment_intent
                });

                if (existingPayment) {
                    return res.send({
                        success: true,
                        message: "Payment already recorded"
                    });
                }

                const contest = await contestsCollection.findOne({
                    _id: new ObjectId(contestId)
                });

                if (!contest) {
                    return res.status(404).send({ message: "Contest not found" });
                }

                // Check already registered
                if (contest.participants?.includes(email)) {
                    return res.send({
                        success: true,
                        message: "User already registered"
                    });
                }

                // Update contest → add participant
                const updateResult = await contestsCollection.updateOne(
                    { _id: new ObjectId(contestId) },
                    {
                        $addToSet: { participants: email }
                    }
                );

                //  Save payment record
                const paymentRecord = {
                    contestId,
                    contestName,
                    email,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    transactionId: session.payment_intent,
                    paidAt: new Date(),
                    paymentStatus: session.payment_status
                };

                await paymentCollection.insertOne(paymentRecord);

                res.send({
                    success: true,
                    message: "User registered successfully",
                    updateResult
                });

            } catch (err) {
                console.error("Contest payment error:", err);
                res.status(500).send({ success: false, message: err.message });
            }
        });


        // Get contests by creator email
        app.get('/my-contests', verifyFBToken, async (req, res) => {

            try {

                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                if (req.decoded_email !== email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }


                const result = await contestsCollection
                    .find({ creatorEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(result);


            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to fetch your contests' });
            }
        });

        // ----Admin related apis----------------

        app.get('/admin/users', verifyFBToken, async (req, res) => {
            try {
                const user = await usersCollection.findOne({
                    email: req.decoded_email
                });

                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                const result = await usersCollection
                    .find()
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch users' });
            }
        });


        app.patch('/admin/users/:id/role', verifyFBToken, async (req, res) => {
            try {

                const { id } = req.params;
                const { role } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid user id' });
                }

                const allowedRoles = ['user', 'creator', 'admin'];

                if (!allowedRoles.includes(role)) {
                    return res.status(400).send({ message: 'Invalid role value' });
                }


                const adminUser = await usersCollection.findOne({
                    email: req.decoded_email
                });

                if (!adminUser || adminUser.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                const targetUser = await usersCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!targetUser) {
                    return res.status(404).send({ message: 'User not found' });
                }

                // Prevent self role change
                if (req.decoded_email === targetUser.email) {
                    return res.status(400).send({
                        message: 'You cannot change your own role'
                    });
                }

                if (targetUser.role === role) {
                    return res.status(400).send({ message: 'User already has this role' });
                }

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );

                res.send({
                    message: 'Role updated successfully',
                    modifiedCount: result.modifiedCount
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to update role' });
            }
        });



        app.get('/admin/contests', verifyFBToken, async (req, res) => {
            try {
                const user = await usersCollection.findOne({
                    email: req.decoded_email
                });

                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                const result = await contestsCollection
                    .find()
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch contests' });
            }
        });

        // Approve contest ( Approve by Admin)
        app.patch('/admin/contests/:id/approve', verifyFBToken, async (req, res) => {
            try {

                const { id } = req.params;
                const email = req.decoded_email;

                const user = await usersCollection.findOne({ email });

                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contest = await contestsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }

                if (contest.status === 'approved') {
                    return res.status(400).send({ message: 'Already approved' });
                }


                const result = await contestsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'approved' } }
                );

                res.send(result);

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to approve contest' });
            }
        });

        app.patch('/admin/contests/:id/reject', verifyFBToken, async (req, res) => {
            try {

                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }


                const user = await usersCollection.findOne({
                    email: req.decoded_email
                });

                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                const contest = await contestsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }



                const result = await contestsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'rejected' } }
                );

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to reject contest' });
            }
        });

        app.delete('/admin/contests/:id', verifyFBToken, async (req, res) => {
            try {

                const { id } = req.params;

                const user = await usersCollection.findOne({
                    email: req.decoded_email
                });

                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ message: 'Admin access required' });
                }

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contest = await contestsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }




                await submissionsCollection.deleteMany({
                    contestId: new ObjectId(id)
                });


                const result = await contestsCollection.deleteOne({
                    _id: new ObjectId(id)
                });

                res.send({
                    message: 'Contest and related submissions deleted',
                    deletedCount: result.deletedCount
                });

            } catch (error) {
                res.status(500).send({ message: 'Failed to delete contest' });
            }
        });

        // edited by creator-----------

        // Update contest
        app.patch('/contests/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;


                const { name, description, price, prizeMoney, deadline, taskInstruction, contestType } = req.body;

                const updatedData = {}

                if (name) {
                    updatedData.name = name;
                }

                if (description) {
                    updatedData.description = description;
                }

                if (price !== undefined) updatedData.price = price;
                if (prizeMoney !== undefined) updatedData.prizeMoney = prizeMoney;
                if (deadline) updatedData.deadline = deadline;
                if (taskInstruction) updatedData.taskInstruction = taskInstruction;
                if (contestType) updatedData.contestType = contestType;


                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contest = await contestsCollection.findOne({ _id: new ObjectId(id) });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }


                if (contest.creatorEmail !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                // Only pending can be edited
                if (contest.status !== 'pending') {
                    return res.status(400).send({
                        message: 'Only pending contests can be updated'
                    });
                }

                const result = await contestsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to update contest' });
            }
        });


        // Delete specific contest
        app.delete('/contests/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contest = await contestsCollection.findOne({ _id: new ObjectId(id) });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }

                // Only creator can delete
                if (contest.creatorEmail !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                // Only if pending
                if (contest.status !== 'pending') {
                    return res.status(400).send({
                        message: 'Only pending contests can be deleted'
                    });
                }

                const result = await contestsCollection.deleteOne({
                    _id: new ObjectId(id)
                });

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to delete contest' });
            }
        });

        // -------Submission related api-------

        app.post('/submissions', verifyFBToken, async (req, res) => {
            try {


                const submission = req.body;

                if (!submission?.contestId) {
                    return res.status(400).send({ message: 'Contest ID required' });
                }

                if (!ObjectId.isValid(submission.contestId)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contestId = new ObjectId(submission.contestId);

                const contest = await contestsCollection.findOne({
                    _id: contestId
                });


                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }


                if (contest.status !== 'approved') {
                    return res.status(400).send({ message: 'Contest not available' });
                }

                // Check the user registered or not
                if (!contest.participants?.includes(req.decoded_email)) {
                    return res.status(403).send({
                        message: 'You must register before submitting'
                    });
                }

                // deadline check
                if (contest.deadline && new Date() > new Date(contest.deadline)) {
                    return res.status(400).send({
                        message: 'Submission deadline passed'
                    });
                }

                //Creator cannot submit
                if (contest.creatorEmail === req.decoded_email) {
                    return res.status(403).send({
                        message: 'Creator cannot submit to own contest'
                    });
                }

                submission.participantEmail = req.decoded_email;
                submission.contestId = contestId;
                submission.isWinner = false;
                submission.submittedAt = new Date();

                const result = await submissionsCollection.insertOne(submission);

                res.send(result);

            } catch (error) {

                if (error.code === 11000) {
                    return res.status(400).send({
                        message: 'You already submitted this contest'
                    });
                }

                res.status(500).send({ message: 'Failed to submit task' });
            }
        });



        app.get('/submissions/contest/:contestId', verifyFBToken, async (req, res) => {
            try {

                const { contestId } = req.params;

                if (!ObjectId.isValid(contestId)) {
                    return res.status(400).send({ message: 'Invalid contest id' });
                }

                const contestObjectId = new ObjectId(contestId);


                const contest = await contestsCollection.findOne({
                    _id: contestObjectId
                });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }


                if (contest.creatorEmail !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                // fetch submissions
                const result = await submissionsCollection
                    .find({ contestId: contestObjectId })
                    .toArray();

                res.send(result);

            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch submissions' });
            }
        });


        // Find creator contests 
        app.get('/creator-submissions', verifyFBToken, async (req, res) => {
            try {

                const email = req.decoded_email;


                const myContests = await contestsCollection
                    .find({ creatorEmail: email })
                    .toArray();

                const contestIds = myContests.map(c => c._id);

                if (contestIds.length === 0) {
                    return res.send([]);
                }


                const submissions = await submissionsCollection
                    .find({ contestId: { $in: contestIds } })
                    .toArray();


                res.send(submissions);

            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch submissions' });
            }
        });

        // select winner related

        app.patch('/submissions/:id/declare-winner', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid submission id' });
                }

                const submission = await submissionsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!submission) {
                    return res.status(404).send({ message: 'Submission not found' });
                }

                const contest = await contestsCollection.findOne({
                    _id: submission.contestId
                });

                if (!contest) {
                    return res.status(404).send({ message: 'Contest not found' });
                }

                if (contest.creatorEmail !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                const existingWinner = await submissionsCollection.findOne({
                    contestId: submission.contestId,
                    isWinner: true
                });

                if (existingWinner) {
                    return res.status(400).send({ message: 'Winner already declared' });
                }

                // add winner to  submission collection
                await submissionsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isWinner: true } }
                );

                // get winner user info
                const winnerUser = await usersCollection.findOne({
                    email: submission.participantEmail
                });

                // Update contest document with winner info
                await contestsCollection.updateOne(
                    { _id: contest._id },
                    {
                        $set: {
                            status: 'completed',
                            winner: {
                                email: submission.participantEmail,
                                name: winnerUser?.name || '',
                                photo: winnerUser?.photo || '',
                                declaredAt: new Date()
                            }
                        }
                    }
                );

                res.send({ message: 'Winner declared successfully' });

            } catch (error) {
                res.status(500).send({ message: 'Failed to declare winner' });
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
