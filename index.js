const express = require('express');
const app = express();
const bodyParser = require('body-parser')
const sns = require('express-aws-sns')
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({   // to support URL-encoded bodies
	extended: true
})); 
//set up app to subscribe to SNS topic
app.use(sns({
    topic: process.env.ARN
}));

const request = require('request');
const aws = require('aws-sdk');
const fs = require('fs');
var exec = require('child_process').exec;

const s3 = new aws.S3();

const _FILEPATH = '/tmp/';
const _SUBSCRIPTION = 'SubscriptionConfirmation';
const _NOTIFICATION = 'Notification';
const _AWS_SNS_HEADER = 'x-amz-sns-message-type';
const _SONG_BUCKET = process.env.IN_BUCKET;
const _WAVEFORM_BUCKET = process.env.OUT_BUCKET;


//Send post request to S3 with the waveform file
function sendWaveformToS3(waveformFileName){
	return new Promise(function(resolve,reject){
		//Retreive waveform file buffer from server
		fs.readFile(waveformFileName, function(err, data){
			if(err){
				reject(err);
			}

			//set s3 params to include waveform bucket, and buffer data.
			const s3Params = {
				Bucket: _WAVEFORM_BUCKET,
				Key: waveformFileName,
				Body: data
			};

			//upload waveform to s3
			s3.upload(s3Params, function(error, s3Data){
				if(error){
					reject(error);
				}else{
					resolve(s3Data)	
				}
			});

		});
	});
	
}

//Runs waveform creation command on a ubuntu server, creates waveform and removes audio file 
function createWaveform(fileWithPath){
	return new Promise(function(resolve, reject){
		//Get filename without extension to create json waveform
		const fileNameNoExt = fileWithPath.split(".mp3")[0];
		const extType = 'json';
		const execOptions = {
			encoding: 'utf8',
			timeout: 0,
			maxBuffer: 200*1024,
			killSignal: 'SIGTERM',
			cwd: _FILEPATH,
			env: null
		};
		//run audiowavefrom command
		exec('audiowaveform -i '+file+' --pixels-per-second 8 -b 8 -o '+fileNameNoExt+'.'+extType, execOptions, 
			function(error, stdout, stderr){
				if (error) {
					console.error(`exec error: ${error}`);
					reject(err);
				}
				console.log(`stdout: ${stdout}`);
				console.log(`stderr: ${stderr}`);
				//delete audio file synchronously
				fs.unlinkSync(fileWithPath);
				//return path+name of waveform
				resolve(fileNameNoExt+'.'+extType);
			}
		);
	});
}

//Writes song temporarily to server
function saveSong(songData, songFileName){
	return new Promise(function(resolve, reject){
		const file = _FILEPATH + songFileName;
		//save file with generic name that will be overwritten with every request
		fs.writeFile(file, songData.Body, function(err){
			if(err){
				console.log(err);
				reject(err);
			}else{
				reslove(file);
			}	
		});
	});
}

// Endpoint which handles subscription message/notifcation from Amazon SNS service, 
// retreives audioFile from S3 and triggers wavefrom creation
app.post('/createwaveform', function(req, res){
		const notification = req.snsMessage;
		const snsType = notification.Type;
		console.log(snsType);
		if(typeof(snsType) === undefined){
			res.status(500).send();
			return;
		}
		//Subsribe to Amazon topic
		if(snsType === _SUBSCRIPTION){
			const subscriptionUrl = notification.SubscribeURL;
			console.log(subscriptionUrl);
			//Send get request to subscriptionUrl to subscribe to topic
			request.get(subscriptionUrl);
			//Send back success status code to stop subscription messages from retrying
			res.status(200).send();
		}else if(snsType === _NOTIFICATION){
			//Retreive file from S3 using objectKey and begin Waveform creation
			const parsedMessage = JSON.parse(notification.Message);

			const s3FileKey = parsedMessage.Records.s3.object.key
			console.log(s3FileKey);
			const s3Params = {
				Bucket: _SONG_BUCKET,
				Key: s3FileKey,
			};
			s3.getObject(s3Params, function(err, data){
				if(err){
					//If error, log it and resend notification again
					console.log(err, err.stack);
					res.status(500).send();
				}else{
					//Begin Waveform creation process, and send success code if successful, else send failure code to resend notification.
					saveSong(data, s3FileKey).
					then(createWaveform).
					then(sendWaveformToS3).
					then(function(s3UploadData){
						console.log(s3UploadData.toString());
						res.status(200).send();
					}).catch(function(err){
						console.log(err);
						res.status(500).send();
					});	
				}
			});
		}

});

app.get('/', function(req, res){
	console.log('s3-waveform-generator accessed!');
});

app.listen(8080);