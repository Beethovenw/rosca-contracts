"use strict";

let Promise = require("bluebird");
let co = require("co").wrap;
let assert = require('chai').assert;
let utils = require("./utils/utils.js");

contract('ROSCA startRound Unit Test', function(accounts) {
    // Parameters for new ROSCA creation
    const ROUND_PERIOD_IN_SECS = 100;
    const MEMBER_LIST = [accounts[1], accounts[2], accounts[3]];
    const CONTRIBUTION_SIZE = 1e16;
    const SERVICE_FEE_IN_THOUSANDTHS = 2;

    const MEMBER_COUNT = MEMBER_LIST.length + 1;
    const START_TIME_DELAY = 10; // 10 seconds buffer

    it("watches for LogstartOfRound event", co(function* () {
        let rosca = yield utils.createEthROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
            MEMBER_LIST, SERVICE_FEE_IN_THOUSANDTHS);

        utils.increaseTime(START_TIME_DELAY);
        let result = yield rosca.startRound();
        let log = result.logs[0]

        assert.equal(log.args.currentRound, 1, "Log didnt show currentRound properly");
    }));

    it("watches for LogEndOfROSCA event", co(function* () {
        let rosca = yield utils.createEthROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
            MEMBER_LIST, SERVICE_FEE_IN_THOUSANDTHS);

        let eventFired = false;
        let endOfRoscaEvent = rosca.LogEndOfROSCA();  // eslint-disable-line new-cap
        endOfRoscaEvent.watch(function(error, log) {
            endOfRoscaEvent.stopWatching();
            eventFired = true;
        });

        for (let i = 0; i < MEMBER_COUNT + 1; i++) { // +1, to startRound
            utils.increaseTime(ROUND_PERIOD_IN_SECS);
            yield rosca.startRound();
            assert.isNotOk(eventFired);
        }

        yield Promise.delay(1000); // 1000ms delay to allow the event to fire properly
        assert.isOk(eventFired, "endOfROSCA event didn't fire");
    }));

    it("Throws when calling startRound before roundStartTime (including round = 0)", co(function* () {
        let rosca = yield utils.createEthROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
            MEMBER_LIST, SERVICE_FEE_IN_THOUSANDTHS);

        for (let i = 0; i < MEMBER_COUNT + 1; i++) {
            yield utils.assertThrows(rosca.startRound(), "expected calling startRound before roundStartTime to throw");

            yield rosca.contribute({from: accounts[2], value: CONTRIBUTION_SIZE});

            utils.increaseTime(ROUND_PERIOD_IN_SECS);
            yield rosca.startRound();
        }
        assert.isOk(yield rosca.endOfROSCA.call());  // Unfortunately, we need to check the internal var directly.
    }));
});
