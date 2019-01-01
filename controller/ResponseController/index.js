const _ = require('lodash');
const VError = require('verror');

const ScoringController = require('./../ScoringController/index');
const { Response, Challenge } = require('../../model/index');
const { RESPONSE_STATUSES } = require('../../lib/constants');
const utils = require('./utils');

class ResponseController {
  static begin(challengeId, uid) {
    return Challenge.findById(challengeId)
      .then(challenge => {
        if (!challenge) return Promise.reject(new VError('Challenge not found'));

        const attributes = {
          uid,
          challengeId,
          status: RESPONSE_STATUSES.IN_PROGRESS,
          responses: utils.createResponsesDoc(challenge),
          scoring: ScoringController.createScoringDoc(challenge),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const newResponse = new Response(attributes);

        return newResponse.save().then(() => newResponse);
      })
  }
  

  static submitResponses(responseId, newResponses) {
    if (_.isEmpty(newResponses)) {
      return Promise.reject(new VError('No responses submitted'));
    }
    
    return Response.findById(responseId)
      .then(response => {
        if (!response) return Promise.reject(new VError('Response not found'));
        if (response.status !== RESPONSE_STATUSES.IN_PROGRESS) return Promise.reject(new VError('Unable to update response that has been completed'));

        // todo johno - validate response type
        const updatedResponses = _.assign({}, response.responses, newResponses);

        _.assign(response, {
          responses: updatedResponses,
          updatedAt: new Date()
        });

        return response.save();
      })
  }

  static finalize(responseId, uid) {
    return Response.findById(responseId)
      .then(response => {
        if (!response) return Promise.reject(new VError(`Response not found: ${responseId}`));
        if (response.status !== RESPONSE_STATUSES.IN_PROGRESS) return Promise.reject(new VError('Response is already finalized'));
        if (response.uid !== uid) return Promise.reject(new VError('Response does not belong to user.'));
        
        return Promise.props({
          response: Promise.resolve(response),
          challenge: Challenge.findById(response.challengeId)
            .then(challenge => challenge || Promise.reject(`Challenge not found`))
        });
      })
      .then(results => {
        const response = results.response;
        const challenge = results.challenge;
        const scoringDoc = response.scoring;

        const multipleChoiceScores = ScoringController.getMultipleChoiceQuestionScores(challenge, response);
        _.assign(scoringDoc.questions, multipleChoiceScores);

        ScoringController.assignStatusAndOverallScore(scoringDoc);

        const updatedScoringDoc = _.cloneDeep(scoringDoc);
        console.log({ updatedScoringDoc });

        // NOTE - I have no idea why this is necessary, it's driving me crazy, but it works. Otherwise updatedScoringDoc won't persist in the DB.
        response.scoring = null;
        _.assign(response, {
          status: RESPONSE_STATUSES.COMPLETE,
          scoring: updatedScoringDoc,
          updatedAt: new Date()
        });

        return response.save().then(() => {
          console.log({ savedResponse: response });
          return response;
        });
      });
  }
  
  static findOne(responseId) {
    return Response.findById(responseId);
  }

  static submitScores(responseId, scoringDocSubmitted) {
    return Response.findById(responseId)
      .then(response => {
        if (!response) {
          return Promise.reject(new VError(`Response not found: ${responseId}`));
        }

        const invalidQuestionIds = _(scoringDocSubmitted).keys().filter(questionId => !_.has(response.responses, questionId)).value();
        if (!_.isEmpty(invalidQuestionIds)) {
          return Promise.reject(`Invalid question IDs: ${invalidQuestionIds}`);
        }

        const scoringDoc = response.scoring;
        
        _.each(scoringDocSubmitted, (scoreObj, questionId) => {
          const score = scoreObj.score;
          const notes = scoreObj.notes;
          
          const questionScore = _.get(scoringDoc.questions, questionId) || {};
          if (_.isNumber(score)) {
            _.set(questionScore, 'score', score);
          }
          
          if (!_.isEmpty(notes)) {
            _.set(questionScore, 'notes', notes);
          }
        });
        
        ScoringController.assignStatusAndOverallScore(scoringDoc);

        response.scoring = null;
        _.assign(response, {
          scoring: scoringDoc,
          updatedAt: new Date()
        }); // todo johno - remove updatedAt boilerplate

        return response.save().then(() => response)
      })
  }
}

module.exports = ResponseController;