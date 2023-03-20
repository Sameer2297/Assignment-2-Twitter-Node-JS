const express = require("express");
const app = express();
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(express.json());

let db;

const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(5000, () => {
      console.log("Server started running!!!");
    });
  } catch (err) {
    console.log(`DB Error: ${err.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//Create User API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const checkUser = await db.get(checkUserQuery);
  if (checkUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    const hashedPwd = await bcrypt.hash(password, 10);
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `INSERT INTO user(username,password,name,gender) VALUES('${username}','${hashedPwd}','${name}','${gender}');`;
      const createUser = await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//Login User API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const verifyUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const verifyUser = await db.get(verifyUserQuery);
  if (verifyUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPwdMatched = await bcrypt.compare(password, verifyUser.password);
    if (isPwdMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "My_token");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Token Authenticator
const tokenAuthenticator = async (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let accessToken;
  if (authHeader !== undefined) {
    accessToken = authHeader.split(" ")[1];
  }
  if (accessToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(accessToken, "My_token", async (error, user) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = user.username;
        next();
      }
    });
  }
};

//Get Tweets of Users followed by Logged User API
app.get("/user/tweets/feed", tokenAuthenticator, async (request, response) => {
  const { username } = request;
  const getLoggedUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUser = await db.get(getLoggedUserQuery);
  const getFollowersQuery = `SELECT following_user_id FROM user JOIN follower ON user.user_id = follower.follower_user_id WHERE user.user_id = ${loggedUser.user_id};`;
  let followersDetails = await db.all(getFollowersQuery);
  followersDetails = followersDetails.map((each) => each.following_user_id);
  //console.log(followersDetails);
  const getTweetsQuery = `SELECT user.username,tweet.tweet,tweet.date_time AS dateTime FROM user JOIN tweet ON user.user_id = tweet.user_id WHERE user.user_id IN (${followersDetails}) ORDER BY tweet.date_time DESC LIMIT 4;`;
  const tweetsDetails = await db.all(getTweetsQuery);
  response.send(tweetsDetails);
});

//Get usernames of the user followed by logged user API
app.get("/user/following/", tokenAuthenticator, async (request, response) => {
  const { username } = request;
  const getLoggedUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUser = await db.get(getLoggedUserQuery);
  const getFollowersQuery = `SELECT following_user_id FROM user JOIN follower ON user.user_id = follower.follower_user_id WHERE user.user_id = ${loggedUser.user_id};`;
  let followersDetails = await db.all(getFollowersQuery);
  followersDetails = followersDetails.map((each) => each.following_user_id);
  const followerNamesQuery = `SELECT name FROM user WHERE user_id IN (${followersDetails});`;
  const followerNames = await db.all(followerNamesQuery);
  response.send(followerNames);
});

//Get usernames of the users following logged user API
app.get("/user/followers/", tokenAuthenticator, async (request, response) => {
  const { username } = request;
  const getLoggedUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUser = await db.get(getLoggedUserQuery);
  const getFollowersQuery = `SELECT * FROM user JOIN follower ON user.user_id = follower.follower_user_id WHERE follower.following_user_id = ${loggedUser.user_id};`;
  let followersDetails = await db.all(getFollowersQuery);
  followersDetails = followersDetails.map((each) => each.follower_user_id);
  const followerNamesQuery = `SELECT name FROM user WHERE user_id IN (${followersDetails});`;
  const followerNames = await db.all(followerNamesQuery);
  response.send(followerNames);
});

const usersFollowedByLoggedUser = async (request, response, next) => {
  const { username } = request;
  const getLoggedUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUser = await db.get(getLoggedUserQuery);
  const getFollowingQuery = `SELECT following_user_id FROM user JOIN follower on user.user_id = follower.follower_user_id WHERE user.user_id = ${loggedUser.user_id};`;
  let followersDetails = await db.all(getFollowingQuery);
  followersDetails = followersDetails.map((each) => each.following_user_id);
  //console.log(followersDetails);
  if (followersDetails.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    request.followersDetails = followersDetails;
    next();
  }
};

//Get Tweets by Tweet_id API
app.get(
  "/tweets/:tweetId/",
  tokenAuthenticator,
  usersFollowedByLoggedUser,
  async (request, response) => {
    const { tweetId } = request.params;
    const { followersDetails } = request;
    const tweetsOfFollowingUsersQuery = `SELECT tweet_id FROM tweet WHERE user_id IN (${followersDetails});`;
    let tweetIds = await db.all(tweetsOfFollowingUsersQuery);
    tweetIds = tweetIds.map((each) => each.tweet_id);
    const countOfReplyAndLikeQuery = `SELECT tweet.tweet,COUNT(like.like_id) AS likes, COUNT(reply.reply_id) AS replies,tweet.date_time AS dateTime FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) AS S JOIN reply ON S.tweet_id = reply.tweet_id WHERE tweet.tweet_id IN (${tweetIds});`;
    const countOfReplyAndLikes = await db.all(countOfReplyAndLikeQuery);
    response.send(countOfReplyAndLikes);
  }
);

//Get Likes by Tweet_id API
app.get(
  "/tweets/:tweetId/likes/",
  tokenAuthenticator,
  usersFollowedByLoggedUser,
  async (request, response) => {
    const { followersDetails } = request;
    const { tweetId } = request.params;
    const getLikedUserNamesQuery = `SELECT user.username AS likes FROM user JOIN like ON user.user_id = like.user_id WHERE like.tweet_id = ${tweetId};`;
    let likedUsers = await db.all(getLikedUserNamesQuery);
    likedUsers = likedUsers.map((each) => each.likes);
    response.send({ likes: likedUsers });
  }
);

//Get Replies by Tweet_id API
app.get(
  "/tweets/:tweetId/replies/",
  tokenAuthenticator,
  usersFollowedByLoggedUser,
  async (request, response) => {
    const { followersDetails } = request;
    const { tweetId } = request.params;
    const getUserRepliesQuery = `SELECT user.name,reply.reply FROM user JOIN reply ON user.user_id = reply.user_id WHERE reply.tweet_id = ${tweetId};`;
    let userReplies = await db.all(getUserRepliesQuery);
    response.send({ replies: userReplies });
  }
);

//Get User Tweets API
app.get("/user/tweets/", tokenAuthenticator, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUserId = await db.get(getUserIdQuery);
  const getAllTweetsQuery = `SELECT tweet.tweet AS tweet,COUNT(DISTINCT(like.like_id)) AS likes,COUNT(DISTINCT(reply.reply_id)) AS replies, tweet.date_time AS dateTime FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) JOIN reply ON tweet.tweet_id = reply.tweet_id WHERE tweet.user_id = ${loggedUserId.user_id} GROUP BY tweet.tweet_id;`;
  const allTweetsArray = await db.all(getAllTweetsQuery);
  response.send(allTweetsArray);
});

//Create Tweet API
app.post("/user/tweets/", tokenAuthenticator, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const loggedUserId = await db.get(getUserIdQuery);
  const { tweet } = request.body;
  const todaysDateTime = new Date();
  console.log(todaysDateTime);
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time) VALUES('${tweet}',${loggedUserId.user_id},'${todaysDateTime}');`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//Delete Tweet API
app.delete(
  "/tweets/:tweetId/",
  tokenAuthenticator,
  async (request, response) => {
    const { username } = request;
    const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const loggedUserId = await db.get(getUserIdQuery);
    const { tweetId } = request.params;
    const getTweetsOfLoggedUserQuery = `SELECT tweet_id FROM tweet WHERE user_id = ${loggedUserId.user_id} AND tweet_id = ${tweetId};`;
    const tweetsArray = await db.all(getTweetsOfLoggedUserQuery);
    if (tweetsArray.length !== 0) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE user_id = ${loggedUserId.user_id} AND tweet_id = ${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
