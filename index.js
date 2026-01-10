const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const admin = require("firebase-admin");

const serviceAccount = require("./fir-template-firebase-adminsdk.json");

// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
//   "utf8"
// );
// const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//this is middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  // console.log("TOKEN:", req.headers.authorization);

  if (!token) {
    return res.status(401).send({ message: `unauthorized access` });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    // console.log("EMAIL:", req.decoded_email);
    next();
  } catch (err) {
    return res.status(401).send({ message: `unauthorized access` });
  }
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gubl8vg.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const myDB = client.db("xports");
    const userCollection = myDB.collection("users");
    const contestCollection = myDB.collection("contests");
    const submissionsCollection = myDB.collection("submissions");

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      // console.log(user);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // verify creator
    const verifyCreator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      // console.log(user);
      if (!user || user.role !== "creator") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }
      const result = userCollection.insertOne(user);
      res.send(result);
      // console.log(user);
    });

    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const { searchText } = req.query;
      const query = {};
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      const cursor = userCollection
        .find(query)
        .sort({ status: -1, createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    //admin stats
    app.get("/admin-stats", verifyFBToken, verifyAdmin, async (req, res) => {
      const totalUsers = await userCollection.countDocuments();
      const totalCreators = await userCollection.countDocuments({
        role: "creator",
      });
      const generalUsers = await userCollection.countDocuments({
        role: "user",
      });
      const totalContests = await contestCollection.countDocuments();
      const activeContests = await contestCollection.countDocuments({
        status: "accepted",
      });
      const revenueResult = await submissionsCollection
        .aggregate([{ $group: { _id: null, totalPrice: { $sum: "$price" } } }])
        .toArray();
      const revenue = revenueResult[0]?.totalPrice || 0;

      //last 6 month
      const userGrowth = await userCollection
        .aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 6 },
        ])
        .toArray();
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const formattedGrowth = userGrowth.map((item) => {
        const [year, month] = item._id.split("-");
        return {
          month: monthNames[parseInt(month) - 1],
          users: item.count,
        };
      });

      res.send({
        totalUsers,
        generalUsers,
        totalCreators,
        totalContests,
        activeContests,
        revenue,
        growth: formattedGrowth,
      });
    });

    //user delete
    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const cursor = userCollection.findOne(query);
      if (!cursor) {
        return res.send({ message: "user not found" });
      }
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
    //role update
    app.patch(
      "/users/role/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;
        console.log(id, role);
        const query = {
          _id: new ObjectId(id),
        };

        try {
          const user = await userCollection.findOne(query);
          if (!user) {
            return res.send({ message: "user not found" });
          }
          const updatedDoc = {
            $set: {
              role: role,
              status: "approved",
            },
          };
          const result = await userCollection.updateOne(query, updatedDoc);
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Server error occurred" });
        }
      }
    );

    //get a user's role
    app.get("/users/role", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      // console.log(email);
      const result = await userCollection.findOne({ email: email });
      res.send({ role: result?.role, status: result?.status });
    });
    //request to make a creator
    app.patch(
      "/users/apply-creator/:email",
      verifyFBToken,
      async (req, res) => {
        const query = {
          email: req.params.email,
        };
        const updatedDoc = {
          $set: {
            status: "pending_creator",
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.post("/contests", verifyFBToken, async (req, res) => {
      const data = req.body;
      // console.log(data);
      const result = await contestCollection.insertOne(data);
      res.send(result);
    });

    //get all contest

    app.get("/contests", async (req, res) => {
      const searchText = req.query.search;
      const skip = parseInt(req.query.skip);
      const limit = parseInt(req.query.limit);
      const type = req.query.type;
      const status = req.query.status;
      let query = {};
      if (status) {
        query.status = status;
      }
      if (searchText) {
        // query.contestName = { $regex: searchText, $options: "i" };
        query.$or = [
          {
            contestName: { $regex: searchText, $options: "i" },
          },
          { contestType: { $regex: searchText, $options: "i" } },
        ];
      }
      if (type && type !== "All") {
        query.contestType = type;
      }
      const result = await contestCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .sort({ participantsCount: -1 })
        .toArray();
      const total = await contestCollection.countDocuments(query);
      res.send({
        contests: result,
        total: total,
      });
    });

    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      let query = {
        _id: new ObjectId(id),
      };
      const result = await contestCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/my-contests", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const query = {
        ownerEmail: email,
      };
      const result = await contestCollection.find(query).toArray();
      const total = await contestCollection.countDocuments(query);
      res.send(result);
    });
    app.delete("/contests/:id", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const { id } = req.params;
      const query = {
        _id: new ObjectId(id),
        ownerEmail: email,
      };
      const result = await contestCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/contests/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { email } = req.query;
      const data = req.body;
      const query = {
        _id: new ObjectId(id),
        ownerEmail: email,
      };

      const updatedDoc = {
        $set: {
          contestName: data.contestName,
          contestType: data.contestType,
          price: data.price,
          prizeMoney: data.prizeMoney,
          instruction: data.instruction,
          description: data.description,
          deadline: data.deadline,
        },
      };

      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    //submissions task
    app.post("/submissions/task", verifyFBToken, async (req, res) => {
      const data = req.body;
      console.log(data);
      const { participantEmail, contestId, submissionLink, submittedAt } =
        req.body;
      let query = {
        participantEmail: participantEmail,
        contestId: contestId,
      };
      const submissions = await submissionsCollection.findOne(query);
      if (!submissions) {
        return res.status(404).send({
          message: "Registration not found for this contest",
        });
      }
      if (submissions.submissionStatus === "submitted") {
        return res.status(400).send({
          message: "You have already submitted for this contest",
          registered: true,
        });
      }

      const result = await submissionsCollection.updateOne(
        {
          _id: new ObjectId(submissions._id),
        },
        {
          $set: {
            submissionLink: submissionLink,
            submissionStatus: "submitted",
            submittedAt: submittedAt,
          },
        },
        { upsert: true }
      );
      res.send(result);
    });

    //check is registered (paid)
    app.get("/submissions/check-registration", async (req, res) => {
      const { email, contestId } = req.query;
      if (!email || !contestId) {
        return res.status(400).send({ message: "Missing params" });
      }

      let query = {
        participantEmail: email,
        contestId: contestId,
        paymentStatus: "paid",
      };
      const submission = await submissionsCollection.findOne(query);
      if (submission) {
        return res.send({
          registered: true,
          status: submission.submissionStatus,
        });
      }
      res.send({ registered: false });
    });

    //handling pending contest by admin
    app.patch(
      "/pending-contests/:contestId",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { status } = req.query;
        console.log(status);
        const query = {
          _id: new ObjectId(req.params.contestId),
        };
        const updatedDoc = {
          $set: {
            status: status,
          },
        };
        const result = await contestCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    //delete contests by admin => future veriffy admni korte hbe
    app.delete(
      "/admin/contests/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const query = {
          _id: new ObjectId(id),
        };
        const result = await contestCollection.deleteOne(query);
        res.send(result);
      }
    );

    // total submissions by contest
    app.get("/contests/:contestId/submissions", async (req, res) => {
      const query = {
        contestId: req.params.contestId,
      };
      const result = await submissionsCollection.find(query).toArray();
      res.send(result);
    });

    // winner selected api
    app.patch("/declare-winner/:contestId", async (req, res) => {
      const { contestId } = req.params;
      const { participantEmail, participantName, _id, participantPhoto } =
        req.body;

      //update in contest collection
      await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        {
          $set: {
            winnerName: participantName,
            winnerEmail: participantEmail,
            winnerPhoto: participantPhoto,
            status: "completed",
            wonDate: new Date(),
          },
        }
      );
      // winner mark in submision collection
      const result = await submissionsCollection.updateOne(
        { _id: new ObjectId(_id) },
        { $set: { isWinner: true } }
      );

      res.send(result);
    });

    //contest won by user
    app.get("/winners", async (req, res) => {
      try {
        const email = req.query.email;
        const limit = parseInt(req.query.limit);
        let query = {};
        if (email) {
          query.winnerEmail = email;
        } else {
          query.winnerEmail = { $exists: true, $ne: "" };
        }
        const result = await contestCollection
          .find(query)
          .sort({ deadline: -1 })
          .limit(limit)
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    //top performers
    app.get("/top-performers", async (req, res) => {
      const result = await contestCollection
        .aggregate([
          { $match: { winnerEmail: { $exists: true, $ne: "" } } },
          {
            $group: {
              _id: "$winnerEmail", //Unique Identifier ekoi email er group
              name: { $first: "$winnerName" }, //first jei contest pabe seta pick korbe
              photo: { $first: "$winnerPhoto" },
              totalWins: { $sum: 1 },
              totalEarnings: { $sum: { $toDouble: "$prizeMoney" } },
            },
          },
          {
            $sort: { totalWins: -1, totalEarnings: -1 },
          },
          {
            $limit: 3,
          },
        ])
        .toArray();

      res.send(result);
    });

    //participate contest by individual
    app.get("/participate", async (req, res) => {
      try {
        const email = req.query.email;

        let query = {};
        if (email) {
          query = {
            participantEmail: email,
          };
        }
        const result = await submissionsCollection
          .find()
          .sort({ deadline: 1 })
          .toArray(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error", error });
      }
    });

    //===================payment related api====================

    app.post("/create-checkout-session", async (req, res) => {
      const submitInfo = req.body;
      console.log("here ir is", submitInfo);
      const amount = parseInt(submitInfo.price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,

              product_data: {
                name: `Please pay for : ${submitInfo.contestName}`,
                description: submitInfo?.description,
                images: [submitInfo?.image],
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          contestId: submitInfo.contestId,
          participantName: submitInfo.participantName,
          participantPhoto: submitInfo.participantPhoto,
        },
        customer_email: submitInfo.participantEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled/${submitInfo.contestId}`,
      });

      res.send({ url: session.url });
    });

    app.get("/checkout-session/:sessionId", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          req.params.sessionId
        );
        res.send({
          transactionId: session.payment_intent,
          contestId: session.metadata.contestId,
          email: session.customer_email,
          paymentStatus: session.payment_status,
          amount: session.amount_total,
        });
      } catch (error) {
        res.status(400).send({ error: error.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const existingPayment = await submissionsCollection.findOne({
        transactionId: session.payment_intent,
      });
      if (existingPayment) {
        return res.send({ success: true, message: "Already processed" });
      }

      const {
        contestId,
        contestName,
        contestType,
        prizeMoney,
        bannerImage,
        ownerEmail,
        deadline,
      } = await contestCollection.findOne({
        _id: new ObjectId(session.metadata.contestId),
      });
      const submitInfo = {
        contestName: contestName,
        contestId: session.metadata.contestId,
        contestType: contestType,
        bannerImage: bannerImage,
        ownerEmail: ownerEmail,
        participantEmail: session.customer_email,
        participantName: session.metadata.participantName,
        participantPhoto: session.metadata.participantPhoto,
        paymentStatus: session.payment_status,
        transactionId: session.payment_intent,
        submissionStatus: "pending",
        prizeMoney: prizeMoney,
        price: session.amount_total / 100,
        paidAt: new Date(),
        deadline: deadline,
      };
      console.log("sbmit info", submitInfo);
      const result = await submissionsCollection.insertOne(submitInfo);

      // update participations in contest
      await contestCollection.updateOne(
        {
          _id: new ObjectId(session.metadata.contestId),
        },
        { $inc: { participantsCount: 1 } }
      );

      return res.send({
        success: true,
      });
    });
  } catch (error) {
    console.log(error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
