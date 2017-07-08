const util = require('util');
const EventEmitter = require('events').EventEmitter;
const AWS = require('aws-sdk');
const Task = require('./task.js');

const stepfunction = new AWS.StepFunctions();

/**
* @class Pooler
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.workerName=null]
* */

function Pooler(options) {
	EventEmitter.call(this);

	this._running = true;
	this._task = false;
	this.activityArn = options.activityArn;
	this.worker = options.worker;
	this.index = options.index;
	this.workerName = options.workerName && options.workerName + '-' + this.index;
	this._request = null;
	this.pool();
}

Pooler.prototype.stop = function (cb) {
	this._running = false;
	if (this._task) {
		this._task.removeAllListeners();
	}
	if (this._request) {
		this.on('stopPooling', () => {
			this.removeAllListeners();
			cb();
		});
    // This would be better approach but it does not seem to work
    // this._request.abort();
	} else {
		cb();
	}
};

Pooler.prototype.report = function () {
	return {
		workerName: this.workerName,
		status: (this._task ? 'Task under going' : (this._running ? 'Waiting for Tasks' : 'Paused')),
		task: this._task && this._task.report()
	};
};

Pooler.prototype.restart = function () {
	this._running = true;
	this.pool();
};

Pooler.prototype.pool = function () {
	if (this._running) {
		if (this._task) {
			throw (new Error('pool should not be called when task on going'));
		}
		if (this._request) {
			throw (new Error('pool should not be called when request on going'));
		}
		this.getActivityTask();
	} else {
		this.emit('stopPooling');
	}
};

Pooler.prototype.getActivityTask = function () {
	try {
		this._request = stepfunction.getActivityTask({
			activityArn: this.activityArn,
			workerName: this.workerName
		}, (err, data) => {
			this._request = null;
			if (err) {
        // Console.log(err);
				if (err.code === 'RequestAbortedError') {
          // In case of abort, close silently
				} else {
					this.emit('error', err);
				}
				return;
			}

			if (data.taskToken && typeof (data.taskToken) === 'string' && data.taskToken.length > 1) {
				const params = Object.assign({}, data, {input: JSON.parse(data.input)});

				this.worker.emit('task', params);

				this._task = new Task(Object.assign({}, params, {worker: this.worker, workerName: this.workerName}));

				this._task.once('finish', () => {
					this._task = null;
					this.pool();
				});
			} else {
				this.pool();
			}
		});
	} catch (err) {
		console.log('caught err', err);
	}
};

util.inherits(Pooler, EventEmitter);

module.exports = Pooler;